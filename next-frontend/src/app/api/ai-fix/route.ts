import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const THEME_PATH = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");

// Detect page type from URL
function detectPageType(url: string): string {
    if (url.includes("/products/")) return "product";
    if (url.includes("/collections/")) return "collection";
    if (url.includes("/pages/")) return "page";
    if (url.includes("/blogs/") || url.includes("/articles/")) return "blog";
    if (url.includes("/cart")) return "cart";
    return "index";
}

// Get relevant template and section files based on page type
function getTemplateFiles(pageType: string): string[] {
    const base = ["layout/theme.liquid"];
    switch (pageType) {
        case "product":
            return [...base, "templates/product.json", "sections/main-product.liquid"];
        case "collection":
            return [...base, "templates/collection.json", "sections/main-collection-product-grid.liquid"];
        case "page":
            return [...base, "templates/page.json", "sections/main-page.liquid"];
        case "blog":
            return [...base, "templates/blog.json", "sections/main-blog.liquid"];
        case "cart":
            return [...base, "templates/cart.json", "sections/main-cart.liquid", "sections/main-cart-items.liquid"];
        default:
            return [...base, "templates/index.json"];
    }
}

// Extract relevant code snippets around specific lines of interest
function extractRelevantSnippet(content: string, searchTerms: string[], contextLines: number = 20): string {
    const lines = content.split('\n');
    const relevantRanges: Set<number> = new Set();

    searchTerms.forEach(term => {
        lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(term.toLowerCase())) {
                // Add context lines before and after
                for (let i = Math.max(0, idx - contextLines); i < Math.min(lines.length, idx + contextLines + 1); i++) {
                    relevantRanges.add(i);
                }
            }
        });
    });

    if (relevantRanges.size === 0) {
        // No matches found, return head and tail
        return lines.slice(0, 100).join('\n') + '\n\n[... middle content omitted ...]\n\n' + lines.slice(-100).join('\n');
    }

    // Convert to sorted array and build contiguous blocks
    const sortedIndices = Array.from(relevantRanges).sort((a, b) => a - b);
    let result = '';
    let lastIdx = -2;

    sortedIndices.forEach(idx => {
        if (idx > lastIdx + 1) {
            if (result) result += '\n\n[... content omitted ...]\n\n';
        }
        result += `${idx + 1}| ${lines[idx]}\n`;
        lastIdx = idx;
    });

    return result;
}

// Extract search terms from audit opportunities
function extractAuditSearchTerms(opportunities: any[]): string[] {
    const terms: Set<string> = new Set();

    opportunities.forEach(opp => {
        if (opp.details?.items) {
            opp.details.items.forEach((item: any) => {
                // Extract filename from URL
                if (typeof item.url === 'string') {
                    const fileName = item.url.split('/').pop()?.split('?')[0];
                    if (fileName) terms.add(fileName);
                }
                // Extract other relevant terms
                if (item.node?.selector) terms.add(item.node.selector);
                if (item.source?.url) {
                    const srcFile = item.source.url.split('/').pop()?.split('?')[0];
                    if (srcFile) terms.add(srcFile);
                }
            });
        }

        // Add audit-specific keywords
        if (opp.id) {
            if (opp.id.includes('css')) terms.add('stylesheet');
            if (opp.id.includes('javascript') || opp.id.includes('js')) terms.add('script');
            if (opp.id.includes('image')) terms.add('img');
            if (opp.id.includes('font')) terms.add('font');
        }
    });

    return Array.from(terms);
}

// ALWAYS read fresh from disk - no caching - IMPROVED with smart snippet extraction
function getContextFiles(pageType: string, opportunities: any[]): Record<string, string> {
    const files: Record<string, string> = {};
    const templateFiles = getTemplateFiles(pageType);

    // 1. Identify all potentially relevant files from the theme directories
    const candidateFiles: string[] = [];
    const folders = ["layout", "sections", "snippets", "assets", "templates"];
    for (const folder of folders) {
        const fullDirPath = path.join(THEME_PATH, folder);
        if (fs.existsSync(fullDirPath) && fs.statSync(fullDirPath).isDirectory()) {
            const dirFiles = fs.readdirSync(fullDirPath);
            for (const f of dirFiles) {
                candidateFiles.push(`${folder}/${f}`);
            }
        }
    }

    // 2. Map audit URLs to identified theme files
    const auditFiles = new Set<string>();
    opportunities.forEach(opp => {
        if (opp.details?.items) {
            opp.details.items.forEach((item: any) => {
                if (typeof item.url === 'string') {
                    const fileName = item.url.split('/').pop()?.split('?')[0];
                    if (fileName) {
                        const match = candidateFiles.find(cf => cf.endsWith(fileName));
                        if (match) auditFiles.add(match);
                    }
                }
            });
        }
    });

    // 3. Prioritize: Template Files first, then top 10 unique audit files
    const uniqueAuditFiles = Array.from(auditFiles).filter(f => !templateFiles.includes(f));
    const finalSet = [...templateFiles, ...uniqueAuditFiles.slice(0, 10)];

    // 4. Read from disk with truncation protection
    finalSet.forEach(f => {
        const fullPath = path.join(THEME_PATH, f);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath, "utf8");
            // Hard limit per file to protect context window
            files[f] = content.length > 25000 ? content.substring(0, 25000) + "\n\n[TRUNCATED DUE TO SIZE]" : content;
        }
    });

    return files;
}

// Calculate confidence score for a fix (0-100)
function calculateConfidenceScore(fix: any, fileContent: string): number {
    let score = 0;

    const snippet = fix.originalSnippet?.trim() || "";
    const fixedSnippet = fix.fixedSnippet?.trim() || "";

    // +40 points: Exact match found
    if (fileContent.includes(snippet)) {
        score += 40;
    } else {
        const normalizedFile = fileContent.replace(/\s+/g, ' ');
        const normalizedSnippet = snippet.replace(/\s+/g, ' ');
        if (normalizedFile.includes(normalizedSnippet)) {
            score += 25; // Normalized match is less confident
        }
    }

    // +20 points: Fixed snippet is different from original (real change)
    if (snippet !== fixedSnippet && fixedSnippet.length > 0) {
        score += 20;
    }

    // +15 points: Has linkedAuditId (maps to PageSpeed opportunity)
    if (fix.linkedAuditId && fix.linkedAuditId.length > 0) {
        score += 15;
    }

    // +10 points: Has savings data (evidence-based)
    if (fix.savings && fix.savings !== "N/A") {
        score += 10;
    }

    // +10 points: Low risk level (safer to apply)
    if (fix.riskLevel === "Low") {
        score += 10;
    } else if (fix.riskLevel === "Medium") {
        score += 5;
    }

    // +5 points: Has detailed explanation
    if (fix.explanation && fix.explanation.length > 100) {
        score += 5;
    }

    // -30 points: Fixed snippet already exists in file (already applied)
    if (fixedSnippet && fileContent.includes(fixedSnippet)) {
        score -= 30;
    }

    return Math.max(0, Math.min(100, score));
}

// Post-process: validate that originalSnippet actually exists in the file on disk
// ENHANCED with confidence scoring and better detection
function validateFixes(fixes: any[]): any[] {
    return fixes.map(fix => {
        const filePath = path.join(THEME_PATH, fix.filePath);
        if (!fs.existsSync(filePath)) {
            fix._validation = "FILE_NOT_FOUND";
            fix._warning = `File '${fix.filePath}' does not exist in the theme.`;
            fix._confidence = 0;
            return fix;
        }

        const fileContent = fs.readFileSync(filePath, "utf8");
        const snippet = fix.originalSnippet?.trim();

        if (!snippet) {
            fix._validation = "NO_SNIPPET";
            fix._warning = "No original snippet provided.";
            fix._confidence = 0;
            return fix;
        }

        // Calculate confidence score
        const confidence = calculateConfidenceScore(fix, fileContent);
        fix._confidence = confidence;

        if (fileContent.includes(snippet)) {
            fix._validation = "VERIFIED";

            // Check if fix is redundant (optimization already applied)
            const fixedTrimmed = fix.fixedSnippet?.trim() || "";
            if (fixedTrimmed && snippet === fixedTrimmed) {
                fix._validation = "ALREADY_APPLIED";
                fix._warning = "This fix suggests no actual change — original and optimized code are identical.";
                fix._confidence = 0;
            } else if (fixedTrimmed && fileContent.includes(fixedTrimmed)) {
                fix._validation = "ALREADY_APPLIED";
                fix._warning = "The optimized code already exists in the file. This fix has already been applied.";
                fix._confidence = Math.min(confidence, 30); // Low confidence for already applied
            }
        } else {
            // Try normalized match (collapse whitespace)
            const normalizedFile = fileContent.replace(/\s+/g, ' ');
            const normalizedSnippet = snippet.replace(/\s+/g, ' ');
            if (normalizedFile.includes(normalizedSnippet)) {
                fix._validation = "VERIFIED_NORMALIZED";
                fix._warning = "Matched after whitespace normalization. Minor formatting differences exist.";
            } else {
                fix._validation = "SNIPPET_NOT_FOUND";
                fix._warning = `The originalSnippet was NOT found in '${fix.filePath}'. This fix may be hallucinated or the code is injected dynamically by Shopify (e.g., content_for_header).`;
                fix._confidence = Math.min(confidence, 20); // Very low confidence
            }
        }
        return fix;
    });
}

// Sort fixes: High confidence first, then by risk level (Low→Medium→High)
function sortByConfidenceAndRisk(fixes: any[]): any[] {
    const riskOrder: Record<string, number> = { "Low": 0, "Medium": 1, "High": 2 };
    return fixes.sort((a, b) => {
        // First sort by confidence (descending)
        const confDiff = (b._confidence || 0) - (a._confidence || 0);
        if (Math.abs(confDiff) > 10) return confDiff; // Significant confidence difference

        // Then sort by risk (ascending - low risk first)
        const aRisk = riskOrder[a.riskLevel] ?? 1;
        const bRisk = riskOrder[b.riskLevel] ?? 1;
        return aRisk - bRisk;
    });
}

// Filter out low-confidence and problematic fixes
function filterHighConfidenceFixes(fixes: any[]): any[] {
    return fixes.filter(fix => {
        // Remove hallucinated fixes
        if (fix._validation === "SNIPPET_NOT_FOUND") return false;
        if (fix._validation === "FILE_NOT_FOUND") return false;
        if (fix._validation === "NO_SNIPPET") return false;

        // Remove already-applied fixes (unless they have very specific purpose)
        if (fix._validation === "ALREADY_APPLIED") return false;

        // Only keep fixes with confidence >= 60
        if ((fix._confidence || 0) < 60) return false;

        return true;
    });
}

export async function POST(req: NextRequest) {
    try {
        const { url, opportunities, diagnostics, scores } = await req.json();

        const pageType = detectPageType(url);

        // HARDCODED MODE: Skip AI, use hand-crafted fixes
        const useHardcoded = process.env.USE_HARDCODED_FIXES === "true";
        if (useHardcoded) {
            const hardcodedPath = path.join(__dirname, "hardcoded-fixes.json");
            let hardcoded;
            if (fs.existsSync(hardcodedPath)) {
                hardcoded = JSON.parse(fs.readFileSync(hardcodedPath, "utf8"));
            } else {
                // Fallback: try relative to cwd
                const altPath = path.join(process.cwd(), "src", "app", "api", "ai-fix", "hardcoded-fixes.json");
                hardcoded = JSON.parse(fs.readFileSync(altPath, "utf8"));
            }
            // Validate, filter, and sort
            if (hardcoded.fixes) {
                hardcoded.fixes = validateFixes(hardcoded.fixes);
                hardcoded.fixes = filterHighConfidenceFixes(hardcoded.fixes);
                hardcoded.fixes = sortByConfidenceAndRisk(hardcoded.fixes);
            }
            return NextResponse.json(hardcoded);
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "API Key is missing" }, { status: 500 });

        const context = getContextFiles(pageType, opportunities || []);

        // Build file inventory for the AI to know what exists
        const fileInventory = Object.keys(context).join(", ");

        // Build the prompt (used by both Claude and Gemini)
        const prompt = `
You are Antigravity, an elite Shopify Performance Engineer specializing in precise, evidence-based optimizations.

=== CONTEXT ===
Page Type: "${pageType}"
URL: ${url}
Current Scores: ${JSON.stringify(scores)}

=== CRITICAL ANTI-HALLUCINATION PROTOCOL ===

⚠️ ABSOLUTE REQUIREMENTS - FAILURE TO FOLLOW = REJECTED FIX:

1. **EXACT CODE MATCHING ONLY**
   - Your 'originalSnippet' MUST be a CHARACTER-PERFECT copy from the Theme Code below
   - Use Find (Ctrl+F) to locate the EXACT code before suggesting it
   - Include the SAME whitespace, indentation, quotes, and line breaks
   - If you cannot find EXACT matching code in the files below, DO NOT suggest a fix

2. **NO CODE INVENTION**
   - You can ONLY work with code that appears in the "Theme Code" section below
   - Do NOT reference files not listed in "FILES AVAILABLE ON DISK"
   - Do NOT suggest code patterns you "think" might exist
   - Do NOT create fixes for third-party scripts (Facebook Pixel, Klaviyo, etc.) unless you see the actual code

3. **VERIFY BEFORE SUGGESTING**
   - Before creating a fix, check if the optimization is ALREADY applied
   - Look for existing: defer, async, loading="lazy", media="print", preload, fetchpriority
   - If a script already has defer="defer", DO NOT suggest adding defer
   - If already optimized, SKIP that opportunity entirely

4. **ONE FIX = ONE AUDIT ITEM**
   - Each fix must map to ONE specific PageSpeed opportunity/diagnostic
   - Use the EXACT title from PageSpeed (e.g., "Reduce unused JavaScript")
   - Extract "linkedAuditId" from the opportunity.id field
   - Copy the "savings" value directly from the PageSpeed data

5. **MINIMAL SURGICAL CHANGES**
   - Change the MINIMUM code necessary
   - Do NOT rewrite entire sections
   - Prefer standard HTML attributes over complex JavaScript
   - Keep existing functionality intact

=== PAGE SCOPING (CRITICAL — READ CAREFULLY) ===
You are optimizing ONLY: ${url} (${pageType} page)

⚠️ STRICT PAGE SCOPING RULES — VIOLATION = REJECTED FIX:

1. **ONLY fix issues that affect THIS page type ("${pageType}")**
   - Every fix MUST improve performance on the "${pageType}" page
   - Do NOT suggest removing/skipping resources on OTHER page types (index, collection, blog, etc.)
   - Do NOT wrap code in template checks for OTHER page types

2. **If modifying layout/theme.liquid (global file)**:
   - Your fix MUST benefit the "${pageType}" page directly
   - If the fix is page-specific, wrap changes in:
     {%- if template contains '${pageType}' -%}
       [your optimization]
     {%- endif -%}
   - UNLESS the fix benefits ALL pages (e.g., deferring a global analytics script)

3. **FORBIDDEN patterns (DO NOT DO THESE)**:
   ❌ "Skip loading X on the index page" — you are NOT optimizing the index page
   ❌ "Only load X on product/collection pages" — this removes X from OTHER pages, not an optimization for THIS page
   ❌ Wrapping code in {%- unless template contains '${pageType}' -%} — this REMOVES functionality from the page you're testing
   ❌ Any fix whose primary benefit is for a DIFFERENT page type

4. **ALLOWED patterns**:
   ✅ Defer/async a script that blocks rendering on the "${pageType}" page
   ✅ Lazy-load images below the fold on the "${pageType}" page
   ✅ Preload critical resources for the "${pageType}" page
   ✅ Optimize code in "${pageType}"-specific template/section files
   ✅ Global optimizations (e.g., defer analytics) that help ALL pages including "${pageType}"

=== PAGESPEED AUDIT DATA (YOUR SOURCE OF TRUTH) ===

Opportunities (issues to fix):
${JSON.stringify(opportunities, null, 2)}

Diagnostics (additional insights):
${JSON.stringify(diagnostics, null, 2)}

=== FILES AVAILABLE ON DISK ===
You may ONLY reference these files:
${fileInventory}

=== THEME CODE (READ FRESH FROM DISK) ===
${Object.keys(context).map(filename => {
            const content = context[filename];
            const lineCount = content.split('\n').length;
            return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE: ${filename} (${lineCount} lines)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${content}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        }).join('\n')}

=== EXAMPLES OF VALID FIXES ===

✅ GOOD Example - Exact Match Found:
PageSpeed says: "Reduce unused JavaScript" - savings: 58 KiB
You find in layout/theme.liquid line 45:
  <script src="jquery-ui.min.js"></script>

Valid fix:
{
  "id": "defer-jquery-ui",
  "title": "Reduce unused JavaScript",
  "linkedAuditId": "unused-javascript",
  "filePath": "layout/theme.liquid",
  "originalSnippet": "  <script src=\"jquery-ui.min.js\"></script>",
  "fixedSnippet": "  <script src=\"jquery-ui.min.js\" defer></script>",
  "savings": "58 KiB",
  "riskLevel": "Low"
}

✅ GOOD Example - Shopify Injected Content:
PageSpeed says: "Reduce third-party code" - Facebook Pixel loads on page
You see in theme.liquid: {{ content_for_header }}

Valid fix:
{
  "id": "defer-content-header",
  "title": "Reduce third-party code",
  "filePath": "layout/theme.liquid",
  "originalSnippet": "{{ content_for_header }}",
  "fixedSnippet": "{%- assign content_for_header_output = content_for_header | replace: '<script ', '<script defer ' -%}\n{{ content_for_header_output }}",
  "explanation": "Uses Liquid filter to add defer to scripts in content_for_header...",
  "riskLevel": "Medium"
}

❌ BAD Example - Hallucinated Code:
You DON'T see any Google Fonts link in the files, but PageSpeed mentions fonts.

Invalid fix (DO NOT DO THIS):
{
  "originalSnippet": "<link href='https://fonts.googleapis.com/...' rel='stylesheet'>"
  // ❌ This code doesn't exist in the theme files provided!
}

Correct approach: SKIP this opportunity if you can't find the actual code.

❌ BAD Example - Already Optimized:
You see: <script src="app.js" defer></script>
PageSpeed says: "Eliminate render-blocking resources" - app.js

Invalid fix (DO NOT DO THIS):
{
  "originalSnippet": "<script src=\"app.js\" defer></script>",
  "fixedSnippet": "<script src=\"app.js\" defer></script>"
  // ❌ No change - already has defer!
}

Correct approach: SKIP this opportunity - already optimized.

=== RESILIENCE & FALLBACK PROTOCOL ===

⚠️ IMPORTANT: DO NOT RETURN 0 FIXES if the page has performance issues, even if PageSpeed doesn't explicitly list them in 'Opportunities'. 

1. **TTFB/Server-Side issues**: Even if the primary bottleneck is TTFB (Time to First Byte) or server response time, you MUST still suggest client-side optimizations that improve subsequent metrics (LCP, TBT, CLS). There is ALWAYS room for client-side improvement.
2. **Sparse Audit Data (NO_FCP)**: If the audit opportunities are empty or sparse, perform a manual audit of the provided "Theme Code" looking for:
   - Third-party scripts (Klaviyo, Facebook, etc.) that aren't deferred
   - Hero images (usually in <img> tags or sections) that lack 'fetchpriority="high"'
   - Large CSS files that could be loaded with media="print" or deferred
   - Injected scripts (content_for_header) that can be filtered and deferred
3. **Always Target 2-5 Fixes**: Unless the page is already perfect (100 score), find valid client-side code optimizations.

=== YOUR TASK ===

Generate 3-5 HIGH-CONFIDENCE fixes (aim for a mix of small best-practice wins and big performance bottlenecks). 

Requirements:
- Each fix MUST have an exact originalSnippet match in the theme code
- Even if TTFB is high, suggest client-side fixes to improve LCP/TBT
- Sort by risk: Low → Medium → High
- If opportunities are empty, look for best-practices (preloading, deferring) in layout/theme.liquid

Return ONLY valid JSON in this format:

{
  "executiveSummary": "1-2 sentences strictly about the ${pageType} page bottlenecks.",
  "fixes": [
    {
      "id": "slug-id",
      "title": "PageSpeed Opportunity Title",
      "explanation": "1-2 concise sentences on what changed and why it helps LCP/TBT/CLS.",
      "filePath": "relative/path/to/file.liquid",
      "linkedAuditId": "audit-id (e.g. 'unused-javascript')",
      "originalSnippet": "EXACT CHARACTER-PERFECT CODE FROM THEME FILES",
      "fixedSnippet": "OPTIMIZED CODE VERSION",
      "impact": "High|Medium|Low",
      "savings": "Savings value (e.g. '58ms')",
      "riskLevel": "Low|Medium|High",
      "isBreaking": false,
      "category": "performance|lcp|fcp|cls|tbt"
    }
  ]
}
REMEMBER: Quality over quantity. Only suggest fixes you can VERIFY with exact code matches. When in doubt, SKIP the fix.
    `;

        const useBedrock = process.env.USE_BEDROCK === "true";
        const useClaude = process.env.USE_CLAUDE === "true";
        const useOpenAI = process.env.USE_OPENAI === "true";

        let responseText: string;

        if (useClaude) {
            // ===== CLAUDE IMPLEMENTATION =====
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const message = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 4096,
                temperature: 0.2,
                messages: [{ role: "user", content: prompt }]
            });
            responseText = message.content[0].type === 'text' ? message.content[0].text : '';
            console.log('[AI-Fix] Using Claude Sonnet 4.6');

        } else if (useBedrock) {
            // ===== AWS BEDROCK IMPLEMENTATION =====
            const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
            const region = process.env.AWS_REGION || "us-east-1";

            const nativeRequest = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 4096,
                temperature: 0.1,
                messages: [
                    { role: "user", content: prompt }
                ],
                system: "You are Antigravity, an elite Shopify Performance Engineer. Output ONLY valid JSON."
            };

            const client = new BedrockRuntimeClient({
                region,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                }
            });

            const command = new InvokeModelCommand({
                modelId,
                body: JSON.stringify(nativeRequest),
                contentType: "application/json",
                accept: "application/json",
            });

            console.log(`[AI-Fix] Invoking Bedrock model ${modelId} in ${region} via AWS SDK`);
            const response = await client.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            responseText = responseBody.content[0].text;
            console.log(`[AI-Fix] Bedrock invocation successful`);

        } else if (useOpenAI) {
            // ===== OPENAI IMPLEMENTATION =====
            const openai = new OpenAI({ apiKey: process.env.CHATGPT_API_KEY || process.env.OPENAI_API_KEY });
            const modelName = process.env.OPENAI_MODEL || "gpt-4o";

            const response = await openai.chat.completions.create({
                model: modelName,
                messages: [
                    { role: "system", content: "You are Antigravity, an elite Shopify Performance Engineer. 1. Exact Code Matching required. 2. Target client-side wins for TTFB issues. 3. Brevity: 1-2 sentence explanations. 4. Return ONLY valid JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 2048,
                response_format: { type: "json_object" }
            });
            responseText = response.choices[0].message.content || "";
            console.log(`[AI-Fix] Using OpenAI model: ${modelName}`);

        } else {
            // ===== GEMINI IMPLEMENTATION =====
            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: "You are Antigravity, an elite Shopify Performance Engineer. 1. Exact Code Matching required. 2. Target client-side wins for TTFB issues. 3. Brevity: 1-2 sentence explanations. 4. Return ONLY valid JSON. 5. Target 2-4 high-impact fixes.",
                generationConfig: { temperature: 0.1, topK: 10, topP: 0.8, maxOutputTokens: 2048, responseMimeType: "application/json" },
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            });
            const result = await model.generateContent(prompt);
            responseText = result.response.text().trim();
            console.log(`[AI-Fix] Using Gemini model: ${modelName}`);
        }

        // Robust JSON extraction - handle markdown fences and extra text
        let jsonContent = responseText;
        // Strip markdown code fences
        jsonContent = jsonContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
        // Find the first { and last } to extract pure JSON
        const firstBrace = jsonContent.indexOf('{');
        const lastBrace = jsonContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
        }

        try {
            // Safety: ensure response at least ends with a closing brace if truncated
            let sanitizedJson = jsonContent;
            if (!sanitizedJson.endsWith('}')) {
                if (sanitizedJson.includes('{')) {
                    // Primitive attempt to salvage
                    if (sanitizedJson.includes('"fixes":') && !sanitizedJson.endsWith(']')) {
                        sanitizedJson += ']';
                    }
                    sanitizedJson += '}';
                }
            }

            const parsed = JSON.parse(sanitizedJson);

            // POST-PROCESSING: Validate, filter, and sort fixes
            if (parsed.fixes && Array.isArray(parsed.fixes)) {
                const originalCount = parsed.fixes.length;

                parsed.fixes = validateFixes(parsed.fixes);

                // Store all fixes (including filtered) for debugging
                const allValidatedFixes = [...parsed.fixes];

                // Filter to high-confidence only
                parsed.fixes = filterHighConfidenceFixes(parsed.fixes);

                // Sort by confidence and risk
                parsed.fixes = sortByConfidenceAndRisk(parsed.fixes);

                // Add metadata about filtering
                parsed._metadata = {
                    originalFixCount: originalCount,
                    validatedFixCount: allValidatedFixes.length,
                    highConfidenceFixCount: parsed.fixes.length,
                    filteredOutCount: allValidatedFixes.length - parsed.fixes.length,
                    allValidatedFixes: allValidatedFixes // For debugging
                };

                console.log(`[AI-Fix] Generated ${originalCount} fixes, validated ${allValidatedFixes.length}, showing ${parsed.fixes.length} high-confidence fixes`);
            }

            return NextResponse.json(parsed);
        } catch (parseError) {
            console.error("Failed to parse AI response - Response may be truncated");
            console.error("Response length:", responseText.length);
            console.error("First 500 chars:", responseText.slice(0, 500));
            console.error("Last 200 chars:", responseText.slice(-200));

            // Try to salvage partial JSON by finding incomplete objects
            let salvaged = null;
            try {
                // Attempt to complete the JSON by finding the last complete fix object
                const fixesMatch = responseText.match(/"fixes"\s*:\s*\[([\s\S]*)/);
                if (fixesMatch) {
                    // Find complete fix objects (those that end with })
                    const fixesContent = fixesMatch[1];
                    const completeFixMatches = fixesContent.match(/\{[^}]*"category"\s*:\s*"[^"]*"[^}]*\}/g);

                    if (completeFixMatches && completeFixMatches.length > 0) {
                        const executiveSummary = responseText.match(/"executiveSummary"\s*:\s*"([^"]*)"/)?.[1] || "Partial response received - some fixes may be incomplete.";
                        salvaged = {
                            executiveSummary,
                            fixes: completeFixMatches.map(fixStr => JSON.parse(fixStr)),
                            _warning: "Response was truncated. Showing only complete fixes. Consider using Claude for longer responses."
                        };
                        console.log(`[AI-Fix] Salvaged ${salvaged.fixes.length} complete fixes from truncated response`);
                    }
                }
            } catch (salvageError) {
                console.error("Could not salvage partial response:", salvageError);
            }

            if (salvaged) {
                return NextResponse.json(salvaged);
            }

            return NextResponse.json({
                executiveSummary: "Error: AI response was incomplete or truncated. Please try again with fewer files or update your Gemini model in .env.",
                fixes: [],
                raw: responseText.slice(0, 1000),
                _error: "TRUNCATED_RESPONSE",
                _suggestion: "Try updating to a later Gemini model (e.g., gemini-3.1-flash) in .env for better stability."
            });
        }

    } catch (error: any) {
        console.error("AI Analysis failed:", error);
        return NextResponse.json({ error: "Antigravity Analysis failed", detail: error?.message }, { status: 500 });
    }
}
