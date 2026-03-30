import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

// Function to find common Shopify files
function getContextFiles(themePath: string) {
    const files: Record<string, string> = {};
    const criticalFiles = ["layout/theme.liquid", "config/settings_data.json", "templates/index.json"];

    for (const f of criticalFiles) {
        const fullPath = path.join(themePath, f);
        if (fs.existsSync(fullPath)) {
            // Give AI a larger, cleaner head context
            files[f] = fs.readFileSync(fullPath, "utf8").slice(0, 8000);
        }
    }
    return files;
}

export async function POST(req: NextRequest) {
    try {
        const { url, opportunities, diagnostics, scores } = await req.json();

        const apiKey = process.env.GEMINI_API_KEY || process.env.PAGESPEED_KEY;
        if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is missing" }, { status: 500 });

        const themePath = "/var/www/html/shopify-ai-optimizer/ella-bella";
        const context = getContextFiles(themePath);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // ANTIGRAVITY ENGINE PROMPT - AGGRESSIVE PERFORMANCE STRATEGY
        const prompt = `
      System: You are Antigravity, an elite Shopify Performance Engineer from Google Deepmind.
      Context: Optimizing ${url} with the following scores: ${JSON.stringify(scores)}.
      
      Opportunities: ${JSON.stringify(opportunities, null, 2)}
      Diagnostics: ${JSON.stringify(diagnostics, null, 2)}
      
      Theme Data:
      ${Object.keys(context).map(filename => `#### [${filename}]\n${context[filename]}`).join('\n\n')}

      STRATEGIC DIRECTIVES:
      1. Aggressive Script Management: If 3rd party scripts (Klaviyo, Meta, etc.) are render-blocking, recommend a MutationObserver "Kill Switch" or interaction-based deferral.
      2. Resource Prioritization: Identify LCP images and suggest <link rel="preload" as="image" fetchpriority="high">.
      3. Critical Path Optimization: Analyze layout/theme.liquid for redundant render-blocking CSS/JS.
      4. CLS Stabilization: Ensure images and containers have height/width or aspect-ratio set.
      
      REPORT FORMAT:
      - Executive Analysis: 1–2 sentences on why the site is currently failing.
      - Antigravity Action Plan: Grouped list of technical architectural changes.
      - Critical Path Files: List of theme files that need a "Unit Fix".
      
      Be technical. Use Liquid/JS variable names. Be surgical.
    `;

        const result = await model.generateContent(prompt);
        return NextResponse.json({ report: result.response.text() });

    } catch (error: any) {
        return NextResponse.json({ error: "Antigravity Analysis failed", detail: error?.message }, { status: 500 });
    }
}
