import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

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
        const { url, fixId, title, details, previewOnly, originalSnippet, fixedSnippet, diff, filePath } = await req.json();

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Missing Gemini API Key" }, { status: 500 });

        let fixData: any = null;
        let identifiedFile = filePath || "";
        if (identifiedFile.startsWith('theme/')) identifiedFile = identifiedFile.replace('theme/', '');

        // NEW: PYTHON PATCHER INTEGRATION
        if (diff && identifiedFile && !previewOnly) {
            console.log(`[ApplyFix] Calling Python patcher for ${identifiedFile}`);
            try {
                const pythonScript = path.join(process.cwd(), "..", "scripts", "patcher.py");
                const inputData = JSON.stringify({ filePath: identifiedFile, diff });

                const result = await new Promise<any>((resolve, reject) => {
                    const child = spawn("python3", [pythonScript]);
                    let stdout = "";
                    let stderr = "";

                    child.stdout.on("data", (data) => stdout += data.toString());
                    child.stderr.on("data", (data) => stderr += data.toString());

                    child.on("close", (code) => {
                        if (code !== 0) {
                            reject(new Error(stderr || `Python exit code ${code}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(stdout);
                            resolve(parsed);
                        } catch (e) {
                            reject(new Error(`Failed to parse Python output: ${stdout}`));
                        }
                    });

                    child.stdin.write(inputData);
                    child.stdin.end();
                });

                if (!result.success) {
                    throw new Error(result.error);
                }

                // --- MANIFEST SYNC: Remove the fix from generated-fixes.json after success ---
                const manifestPath = path.join(process.cwd(), "..", "data", "generated-fixes.json");
                if (fs.existsSync(manifestPath)) {
                    try {
                        const manifestContent = fs.readFileSync(manifestPath, 'utf8');
                        const manifest = JSON.parse(manifestContent);
                        if (manifest.fixes && Array.isArray(manifest.fixes)) {
                            const updatedFixes = manifest.fixes.filter((f: any) => f.id !== fixId);
                            manifest.fixes = updatedFixes;
                            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
                            console.log(`[Manifest] Removed fix ${fixId} from manifest.`);
                        }
                    } catch (mErr) {
                        console.error("[Manifest] Failed to sync manifest:", mErr);
                        // Don't fail the whole request just because manifest sync failed
                    }
                }

                return NextResponse.json({
                    success: true,
                    title: title || "Optimization Applied",
                    summary: result.message,
                    fileChanged: identifiedFile,
                    patchDetails: result.patch_details,
                    steps: [
                        "Antigravity Precision Engine engaged.",
                        `Python surgical patch applied to ${identifiedFile}`,
                        "Manifest synchronized (Fix removed from queue)."
                    ]
                });
            } catch (err: any) {
                console.error("[ApplyFix] Python script error:", err);
                return NextResponse.json({ error: `Surgical Patch/Push failed: ${err.message}` }, { status: 500 });
            }
        }

        // --- LEGACY/FALLBACK LOGIC BELOW (if no diff or preview mode) ---

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
