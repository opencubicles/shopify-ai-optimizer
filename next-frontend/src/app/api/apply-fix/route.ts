import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

function callPatcher(inputData: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(process.cwd(), "..", "scripts", "patcher.py");
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
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error(`Failed to parse output: ${stdout}`));
            }
        });

        child.stdin.write(JSON.stringify(inputData));
        child.stdin.end();
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { fixId, title, diff, filePath, originalSnippet, fixedSnippet, previewOnly } = body;

        if (previewOnly) {
            return NextResponse.json({
                success: true,
                title: title || "Preview",
                summary: "Preview mode - no changes applied",
                preview: true
            });
        }

        let identifiedFile = filePath || "";
        if (identifiedFile.startsWith("theme/")) {
            identifiedFile = identifiedFile.replace("theme/", "");
        }

        if (!diff || !identifiedFile || !fixId) {
            return NextResponse.json(
                { error: "Missing fixId, diff, or filePath" },
                { status: 400 }
            );
        }

        console.log(`[ApplyFix] Calling branch-per-fix patcher for ${identifiedFile} (${fixId})`);

        const result = await callPatcher({
            action: "apply",
            fixId,
            title: title || "Optimization",
            diff,
            filePath: identifiedFile,
            originalSnippet: originalSnippet || null,
            fixedSnippet: fixedSnippet || null
        });

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Patch failed" },
                { status: 500 }
            );
        }

        // Remove the fix from generated-fixes.json after successful apply
        const manifestPath = path.join(process.cwd(), "..", "data", "generated-fixes.json");
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
                if (manifest.fixes && Array.isArray(manifest.fixes)) {
                    const fixEntry = manifest.fixes.find((f: any) => f.id === fixId);
                    if (fixEntry) {
                        fixEntry.status = "applied";
                        fixEntry.branch = result.branch;
                    }
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
                    console.log(`[Manifest] Marked fix ${fixId} as applied.`);
                }
            } catch (mErr) {
                console.error("[Manifest] Failed to update:", mErr);
            }
        }

        return NextResponse.json({
            success: true,
            title: title || "Optimization Applied",
            summary: result.message,
            branch: result.branch,
            fileChanged: identifiedFile,
            tier: result.tier,
            steps: [
                "Branch-per-fix engine engaged.",
                `Created isolated branch: ${result.branch}`,
                `Diff applied to ${identifiedFile}`,
                "Fix committed. Ready for deploy merge."
            ]
        });

    } catch (e: any) {
        console.error("Apply Fix Error:", e);
        return NextResponse.json(
            { error: `Patch failed: ${e.message}` },
            { status: 500 }
        );
    }
}
