import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
    try {
        const { filePath } = await req.json();
        const themePath = "/var/www/html/shopify-ai-optimizer/ella-bella";
        const store = process.env.SHOPIFY_STORE || "ella-bella-3505.myshopify.com";
        const themeId = process.env.SHOPIFY_THEME_ID || "185064653119";

        if (!store || !themeId) {
            return NextResponse.json({ error: "Missing Shopify configuration in .env" }, { status: 500 });
        }

        const steps: string[] = [];

        // Step 1: Git Stage
        steps.push(`Step 1: Staging surgical unit (${filePath || "all assets"})...`);
        execSync(`git -C ${themePath} add ${filePath || "."}`);

        // Step 2: Git Commit
        const commitMsg = filePath ? `perf: optimize ${filePath}` : "perf: batch theme optimization";
        steps.push("Step 2: Securing version history (git commit)...");
        try {
            execSync(`git -C ${themePath} commit -m "${commitMsg}" --allow-empty`);
        } catch (e) {
            steps.push("Note: Version at HEAD is identical (no new changes).");
        }

        // Step 3: Shopify Push to SPECIFIC theme (no --unpublished)
        steps.push(`Step 3: Pushing live to Theme ID: ${themeId}...`);

        // Command Optimization: Target exact theme to prevent creation of new themes
        const pushCmd = filePath
            ? `shopify theme push --store ${store} --theme ${themeId} --only ${filePath} --force`
            : `shopify theme push --store ${store} --theme ${themeId} --force`;

        const pushOutput = execSync(pushCmd, { cwd: themePath, encoding: "utf8" });
        steps.push("Step 4: Sync successful! Theme optimized on remote.");

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
