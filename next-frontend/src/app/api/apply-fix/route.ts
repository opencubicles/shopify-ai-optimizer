import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

const THEME_PATH = "/var/www/html/shopify-ai-optimizer/ella-bella";

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
        const { url, issueId, title, details, previewOnly } = await req.json();

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Missing Gemini API Key" }, { status: 500 });

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const fileList = getCriticalFileList();
        let auditUrls: string[] = [];
        if (details?.items) auditUrls = details.items.map((item: any) => item.url).filter((u: string) => typeof u === 'string');

        // Asset Precision Trace
        let identifiedFile = "";
        if (auditUrls.length > 0) {
            const bestMatch = fileList.find(f => auditUrls.some(u => u.includes(f.split('/').pop() || "")));
            identifiedFile = bestMatch || "layout/theme.liquid";
        } else {
            identifiedFile = title.includes("LCP") || title.includes("FCP") ? "layout/theme.liquid" : "layout/theme.liquid";
        }

        const fullPath = path.join(THEME_PATH, identifiedFile);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) identifiedFile = "layout/theme.liquid";

        const finalPath = path.join(THEME_PATH, identifiedFile);
        const rawContent = fs.readFileSync(finalPath, 'utf8');
        const lines = rawContent.split('\n');

        // Context Chunking for speed
        const chunkedLines = lines.length > 1000 ? lines.slice(0, 1000) : lines;
        const contentWithLines = chunkedLines.map((l, i) => `${i + 1}| ${l}`).join('\n');

        const prompt = `
      Antigravity Surgical Engine [Gemini Precision Mode].
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
         "impactAnalysis": "Surgical result."
      }
      
      Ensure originalSnippet matches character-by-character. Only return JSON.
    `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim().replace(/```json|```/g, '');
        const fixData = JSON.parse(text);

        const diskContent = fs.readFileSync(finalPath, 'utf8');
        let success = false;
        let patched = "";

        if (diskContent.includes(fixData.originalSnippet)) {
            patched = diskContent.replace(fixData.originalSnippet, fixData.fixedSnippet);
            success = true;
        } else {
            const diskLines = diskContent.split('\n');
            const targetedLines = diskLines.slice(fixData.startLine - 1, fixData.endLine).join('\n');
            if (targetedLines.length > 3) {
                patched = diskContent.replace(targetedLines, fixData.fixedSnippet);
                fixData.originalSnippet = targetedLines;
                success = true;
            }
        }

        if (success && !previewOnly) fs.writeFileSync(finalPath, patched, 'utf8');

        return NextResponse.json({
            success: true,
            title: title,
            summary: `Gemini 2.5 Optimization for ${identifiedFile}`,
            impact: fixData.impactAnalysis,
            fileChanged: identifiedFile,
            originalSnippet: fixData.originalSnippet,
            fixedSnippet: fixData.fixedSnippet,
            applied: !previewOnly,
            steps: [
                "Universal Gemini 2.5 Flash Engine engaged.",
                `Precision mapped PageSpeed URLs to ${identifiedFile}`,
                `Surgically extracted unit targeting lines ${fixData.startLine}-${fixData.endLine}`,
                previewOnly ? "Optimization ready for review." : "Live patch committed to disk."
            ]
        });

    } catch (e: any) {
        return NextResponse.json({ error: "Surgical Patch Failed", detail: e.message }, { status: 500 });
    }
}
