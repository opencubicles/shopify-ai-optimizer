import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
    try {
        let { filePath } = await req.json();

        // Normalize filePath (Remove leading 'theme/' if AI included it)
        if (filePath && filePath.startsWith("theme/")) {
            filePath = filePath.replace("theme/", "");
        } else if (filePath && filePath.startsWith("./theme/")) {
            filePath = filePath.replace("./theme/", "");
        }

        const themePath = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");
        const store = process.env.SHOPIFY_STORE || "thriveco-in.myshopify.com";
        const themeId = process.env.SHOPIFY_THEME_ID || "153060343948";

        if (!store || !themeId) {
            return NextResponse.json({ error: "Missing Shopify configuration in .env" }, { status: 500 });
        }

        const steps: string[] = [];

        // Step 1: Git Stage
        steps.push(`Step 1: Staging surgical unit (${filePath || "all assets"})...`);
        execSync(`git add -f ${filePath || "."}`, { cwd: themePath });

        // Step 2: Git Commit
        const commitMsg = filePath ? `perf: optimize ${filePath}` : "perf: batch theme optimization";
        steps.push("Step 2: Securing version history (git commit)...");
        try {
            execSync(`git commit -m "${commitMsg}" --allow-empty`, { cwd: themePath });
        } catch (e) {
            steps.push("Note: Version at HEAD is identical (no new changes).");
        }

        // Step 3: Shopify Push to SPECIFIC theme (no --unpublished)
        steps.push(`Step 3: Pushing live to Theme ID: ${themeId}...`);

        // Command Optimization: Target exact theme to prevent creation of new themes
        const pushCmd = filePath
            ? `shopify theme push --store ${store} --theme ${themeId} --only ${filePath} --force`
            : `shopify theme push --store ${store} --theme ${themeId} --force`;

        steps.push(`Running: ${pushCmd}`);

        let pushOutput = "";
        try {
            pushOutput = execSync(pushCmd, {
                cwd: themePath,
                encoding: "utf8",
                timeout: 120000, // 2 minute timeout for slow network
                stdio: ["ignore", "pipe", "pipe"] // Capture both stdout and stderr
            });

            // GHOST ERROR DETECTION: Shopify CLI sometimes returns status 0 even on internal errors
            const lowerOutput = pushOutput.toLowerCase();
            if (lowerOutput.includes("error") || lowerOutput.includes("failed") || lowerOutput.includes("invalid")) {
                throw new Error(`Shopify CLI reported internal error: ${pushOutput}`);
            }

            steps.push("Step 4: Sync successful! Theme optimized on remote.");
        } catch (pushErr: any) {
            const errDetail = pushErr.stderr || pushErr.message;
            console.error("Shopify Push Failed:", errDetail);
            throw new Error(`Shopify Push Failed: ${errDetail}`);
        }

        return NextResponse.json({
            success: true,
            message: `Pushed successfully to theme ${themeId}.`,
            steps: steps,
            output: pushOutput
        });

    } catch (error: any) {
        console.error("Theme Push error:", error);
        return NextResponse.json({
            error: "Theme push failed",
            detail: error.message,
            steps: ["Sequence interrupted at Shopify CLI push."]
        }, { status: 500 });
    }
}
