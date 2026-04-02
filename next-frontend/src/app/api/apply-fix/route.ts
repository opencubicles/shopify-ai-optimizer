import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

const THEME_PATH = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");

function getCriticalFileList() {
    const folders = ["layout", "sections", "snippets", "assets", "templates"];
    const collection: string[] = [];
    for (const folder of folders) {
        const fullDirPath = path.join(THEME_PATH, folder);
        if (fs.existsSync(fullDirPath) && fs.statSync(fullDirPath).isDirectory()) {
            const files = fs.readdirSync(fullDirPath);
            for (const f of files) {
                const fullFilePath = path.join(fullDirPath, f);
                if (fs.existsSync(fullFilePath) && fs.statSync(fullFilePath).isFile()) {
                    if (f.endsWith('.liquid') || f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.json')) {
                        collection.push(`${folder}/${f}`);
                    }
                }
            }
        }
    }
    return collection;
}

export async function POST(req: NextRequest) {
    try {
        const { url, issueId, title, details, previewOnly, originalSnippet, fixedSnippet, filePath } = await req.json();

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Missing Gemini API Key" }, { status: 500 });

        let fixData: any = null;
        let identifiedFile = filePath || "";

        if (originalSnippet && fixedSnippet && identifiedFile) {
            // USE PRE-GENERATED FIX (from Global Analysis or previous Preview)
            fixData = {
                filePath: identifiedFile,
                originalSnippet,
                fixedSnippet,
                impactAnalysis: "Applied from reviewed suggestion."
            };
        } else {
            // GENERATE NEW FIX VIA AI
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const fileList = getCriticalFileList();
            let auditUrls: string[] = [];
            if (details?.items) auditUrls = details.items.map((item: any) => item.url).filter((u: string) => typeof u === 'string');

            // Asset Precision Trace
            if (!identifiedFile) {
                if (auditUrls.length > 0) {
                    const bestMatch = fileList.find(f => auditUrls.some(u => u.includes(f.split('/').pop() || "")));
                    identifiedFile = bestMatch || "layout/theme.liquid";
                } else {
                    identifiedFile = "layout/theme.liquid";
                }
            }

            const themePath = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");
            const fullPath = path.join(themePath, identifiedFile);
            if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) identifiedFile = "layout/theme.liquid";

            const finalPathLoc = path.join(themePath, identifiedFile);
            const rawContent = fs.readFileSync(finalPathLoc, 'utf8');
            const lines = rawContent.split('\n');

            // Context Chunking for speed
            const chunkedLines = lines.length > 1000 ? lines.slice(0, 1000) : lines;
            const contentWithLines = chunkedLines.map((l, i) => `${i + 1}| ${l}`).join('\n');

            const prompt = `
          Antigravity Surgical Engine [Gemini Precision Model].
          Audit: ${title} (${issueId})
          File: ${identifiedFile}
          PageSpeed JSON: ${JSON.stringify(details)}
          
          Source (Lines 1 to ${chunkedLines.length}):
          ${contentWithLines}

          TASK: Return a surgical precision patch JSON:
          {
             "filePath": "${identifiedFile}",
             "originalSnippet": "exact code",
             "fixedSnippet": "optimized code",
             "startLine": number,
             "endLine": number,
             "impactAnalysis": "A 2-3 paragraph technical explanation. PARAGRAPH 1: Detail precisely WHAT was changed in the code. PARAGRAPH 2: Explain WHY this was necessary based on the audit opportunities. PARAGRAPH 3: State the expected performance IMPROVEMENT for this specific unit.",
             "impactScore": "High/Medium/Low",
             "savings": "Estimated ms savings",
             "riskLevel": "High/Medium/Low",
             "isBreaking": boolean
          }
          
          RISK CRITERIA:
          - High: Script deletion/modification, breaking third-party tags.
          - Medium: CSS layout changes, altering Liquid loops.
          - Low: Meta tag additions, preloading assets.

          Ensure originalSnippet matches character-by-character. Only return JSON.
        `;

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim().replace(/```json|```/g, '');
            fixData = JSON.parse(text);
        }

        const finalPath = path.join(THEME_PATH, identifiedFile);
        const diskContent = fs.readFileSync(finalPath, 'utf8');
        let success = false;
        let patched = "";

        // SMART PATCH ENGINE: Exact -> Trimmed -> Fuzzy Identifier
        if (diskContent.includes(fixData.originalSnippet)) {
            patched = diskContent.replace(fixData.originalSnippet, fixData.fixedSnippet);
            success = true;
            console.log(`[Patch] Exact match success for ${identifiedFile}`);
        } else {
            const cleanTarget = fixData.originalSnippet.trim();
            if (diskContent.includes(cleanTarget)) {
                patched = diskContent.replace(cleanTarget, fixData.fixedSnippet);
                success = true;
                console.log(`[Patch] Trimmed match success for ${identifiedFile}`);
            } else {
                // GENERIC RANGE-AWARE ANCHOR (Prevents tag duplication)
                const aiOriginalLines = fixData.originalSnippet.split('\n');
                const cleanAiLines = aiOriginalLines.map((l: string) => l.trim()).filter((l: string) => l.length > 5);
                let foundViaAnchor = false;

                if (cleanAiLines.length > 0) {
                    const longestLine = cleanAiLines.reduce((a: string, b: string) => a.length > b.length ? a : b);
                    const aiAnchorIndex = aiOriginalLines.findIndex((l: string) => l.includes(longestLine));

                    const diskLines = diskContent.split('\n');
                    const diskAnchorIndex = diskLines.findIndex(l => l.includes(longestLine));
                    const occurrences = diskContent.split(longestLine).length - 1;

                    if (diskAnchorIndex !== -1 && occurrences === 1) {
                        // Calculate the start and end of the original block on disk
                        const start = diskAnchorIndex - aiAnchorIndex;
                        const end = start + aiOriginalLines.length;

                        if (start >= 0 && end <= diskLines.length) {
                            const diskOriginalRange = diskLines.slice(start, end).join('\n');
                            // Replace the identified range with the new fix
                            patched = diskContent.replace(diskOriginalRange, fixData.fixedSnippet);
                            success = true;
                            foundViaAnchor = true;
                            console.log(`[Patch] Range Match Success: Found unique anchor at line ${diskAnchorIndex + 1}, replacing ${aiOriginalLines.length} lines.`);
                        }
                    }
                }

                if (!foundViaAnchor) {
                    console.warn(`[Patch] All strategies failed for ${identifiedFile}`);
                    success = false;
                }
            }
        }

        if (success && !previewOnly) {
            fs.writeFileSync(finalPath, patched, 'utf8');
        }

        return NextResponse.json({
            success: success,
            error: success ? null : "Could not find the original code snippet in the file. No changes were applied.",
            title: title,
            summary: `Gemini Optimization for ${identifiedFile}`,
            explanation: fixData.impactAnalysis,
            fileChanged: identifiedFile,
            originalSnippet: fixData.originalSnippet,
            fixedSnippet: fixData.fixedSnippet,
            riskLevel: fixData.riskLevel,
            isBreaking: fixData.isBreaking,
            savings: fixData.savings,
            impact: fixData.impactScore,
            applied: !previewOnly,
            steps: [
                "Antigravity Precision Engine engaged.",
                `Precision mapped to ${identifiedFile}`,
                previewOnly ? "Optimization ready for review." : "Live patch committed to disk sync."
            ]
        });

    } catch (e: any) {
        console.error("Surgical Patch Failed:", e);
        return NextResponse.json({ error: "Surgical Patch Failed", detail: e.message }, { status: 500 });
    }
}
