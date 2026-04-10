import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import fs from "fs";
import path from "path";

const THEME_PATH = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");
const DATA_DIR = path.join(process.cwd(), "..", "data");
const FIXES_FILE = path.join(DATA_DIR, "generated-fixes.json");

// Detect page type from URL
function detectPageType(url: string): string {
    if (url.includes("/products/")) return "product";
    if (url.includes("/collections/")) return "collection";
    if (url.includes("/pages/")) return "page";
    if (url.includes("/blogs/") || url.includes("/articles/")) return "blog";
    if (url.includes("/cart")) return "cart";
    return "index";
}

// Get relevant template and section files base on page type
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

function getContextFiles(pageType: string, targetAsset?: string): Record<string, string> {
    const files: Record<string, string> = {};
    const templateFiles = getTemplateFiles(pageType);

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

    const finalSet = new Set<string>(templateFiles);
    if (targetAsset) {
        const assetName = targetAsset.split('/').pop()?.split('?')[0];
        if (assetName) {
            const match = candidateFiles.find(cf => cf.endsWith(assetName));
            if (match) finalSet.add(match);
        }
    }

    finalSet.forEach(f => {
        const fullPath = path.join(THEME_PATH, f);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath, "utf8");
            files[f] = content.length > 25000 ? content.substring(0, 25000) + "\n\n[TRUNCATED]" : content;
        }
    });

    return files;
}

export async function POST(req: NextRequest) {
    try {
        const { nodeId, title, item, items, url, isBatch } = await req.json();

        const pageType = detectPageType(url || "");
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

        if (!apiKey) return NextResponse.json({ error: "Missing API Key" }, { status: 500 });

        const targetAsset = isBatch ? "" : (item?.url || item?.label || "");
        const context = getContextFiles(pageType, targetAsset);
        const fileInventory = Object.keys(context).join(", ");

        const prompt = `
You are Antigravity, an elite Shopify Performance Engineer.
Task: Generate a surgical performance fix for the following issue.

=== CONTEXT ===
Issue: ${title} (${nodeId})
Target: ${isBatch ? "Multiple resources in category" : targetAsset}
Details: ${JSON.stringify(isBatch ? items : item)}

=== FILES AVAILABLE ===
${fileInventory}

=== THEME CODE ===
${Object.keys(context).map(f => `FILE: ${f}\n${context[f]}\n---`).join('\n')}

=== REQUIREMENTS ===
1. Return ONLY valid JSON.
2. If isBatch is true, return a JSON array of fix objects.
3. If isBatch is false, return a single JSON object.
4. Each fix object must have:
   {
     "id": "unique-slug",
     "title": "${title}",
     "explanation": "concise explanation",
     "filePath": "relative/path/to/file",
     "targetAsset": "filename of asset",
     "originalSnippet": "EXACT code match",
     "fixedSnippet": "optimized code",
     "linkedNodeId": "${nodeId}",
     "impact": "High|Medium|Low",
     "riskLevel": "Low|Medium|High",
     "category": "performance"
   }

If you cannot find an EXACT match for the originalSnippet in the provided files, DO NOT suggest a fix for that item.
`;

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are Antigravity, an elite Shopify Performance Engineer. Output ONLY valid JSON. Exact code matching is mandatory.",
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2048,
                responseMimeType: "application/json"
            },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();
        let generatedFixes: any[] = [];

        try {
            const parsed = JSON.parse(responseText);
            if (isBatch && Array.isArray(parsed)) {
                generatedFixes = parsed;
            } else if (isBatch && parsed.fixes) {
                generatedFixes = parsed.fixes;
            } else if (!isBatch) {
                generatedFixes = [parsed];
            } else {
                generatedFixes = Array.isArray(parsed) ? parsed : [parsed];
            }
        } catch (e) {
            console.error("JSON Parse Error:", e);
            return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
        }

        // SAVE TO FILE
        if (generatedFixes.length > 0) {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

            let manifest: any = { executiveSummary: "", fixes: [] };
            if (fs.existsSync(FIXES_FILE)) {
                try {
                    manifest = JSON.parse(fs.readFileSync(FIXES_FILE, "utf8"));
                } catch (e) {
                    console.error("Manifest Parse Error:", e);
                }
            }

            // Append unique fixes (based on ID or content)
            generatedFixes.forEach(newFix => {
                // Ensure linkedNodeId is set correctly if AI missed it
                if (!newFix.linkedNodeId) newFix.linkedNodeId = nodeId;

                const exists = manifest.fixes.some((f: any) => f.id === newFix.id || (f.originalSnippet === newFix.originalSnippet && f.filePath === newFix.filePath));
                if (!exists) {
                    manifest.fixes.push(newFix);
                }
            });

            fs.writeFileSync(FIXES_FILE, JSON.stringify(manifest, null, 4), "utf8");
        }

        return NextResponse.json({
            success: true,
            message: `Successfully generated and appended ${generatedFixes.length} fix(es).`,
            fixes: generatedFixes
        });

    } catch (error: any) {
        console.error("Generate fix failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
