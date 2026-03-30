import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
    try {
        const { url, device = "mobile" } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        try {
            new URL(url);
        } catch (e) {
            return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
        }

        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const basePath = path.join(tempDir, `report-${timestamp}`);
        const htmlPath = `${basePath}.report.html`;
        const jsonPath = `${basePath}.report.json`;

        try {
            const command = `npx lighthouse ${url} --output html --output json --output-path ${basePath} --chrome-flags="--no-sandbox --disable-setuid-sandbox --headless" --quiet --only-categories=performance,accessibility,best-practices,seo --emulated-form-factor=${device}`;

            console.log(`Executing Lighthouse for deep audit: ${url} (${device})`);
            await execAsync(command, { timeout: 180000 });

            if (!fs.existsSync(htmlPath) || !fs.existsSync(jsonPath)) {
                throw new Error("Lighthouse reports were not generated");
            }

            const reportHtml = fs.readFileSync(htmlPath, "utf8");
            const reportJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

            if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
            if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

            // Extract scores
            const scores = {
                performance: Math.round((reportJson?.categories?.performance?.score || 0) * 100),
                accessibility: Math.round((reportJson?.categories?.accessibility?.score || 0) * 100),
                bestPractices: Math.round((reportJson?.categories?.["best-practices"]?.score || 0) * 100),
                seo: Math.round((reportJson?.categories?.seo?.score || 0) * 100),
            };

            // Extract core metrics
            const metrics = {
                fcp: reportJson?.audits?.["first-contentful-paint"]?.displayValue || "--",
                lcp: reportJson?.audits?.["largest-contentful-paint"]?.displayValue || "--",
                tbt: reportJson?.audits?.["total-blocking-time"]?.displayValue || "--",
                cls: reportJson?.audits?.["cumulative-layout-shift"]?.displayValue || "--",
                si: reportJson?.audits?.["speed-index"]?.displayValue || "--",
                tti: reportJson?.audits?.["interactive"]?.displayValue || "--",
            };

            // Extract opportunities (scored < 0.9)
            const opportunities = Object.values(reportJson.audits)
                .filter((audit: any) => {
                    return (
                        audit.details &&
                        audit.details.type === "opportunity" &&
                        audit.score < 1 &&
                        audit.score !== null
                    );
                })
                .map((audit: any) => ({
                    id: audit.id,
                    title: audit.title,
                    description: audit.description,
                    score: audit.score,
                    displayValue: audit.displayValue,
                    savings: audit.details?.overallSavingsMs || 0,
                }))
                .sort((a, b) => b.savings - a.savings);

            // Extract diagnostics
            const diagnostics = Object.values(reportJson.audits)
                .filter((audit: any) => {
                    return (
                        audit.score < 1 &&
                        audit.score !== null &&
                        !audit.details?.type && // Diagnostics usually don't have opportunity type
                        audit.id !== "first-contentful-paint" &&
                        audit.id !== "largest-contentful-paint" &&
                        audit.id !== "total-blocking-time" &&
                        audit.id !== "cumulative-layout-shift" &&
                        audit.id !== "speed-index" &&
                        audit.id !== "interactive"
                    );
                })
                .slice(0, 5) // Just top 5
                .map((audit: any) => ({
                    id: audit.id,
                    title: audit.title,
                    description: audit.description,
                    displayValue: audit.displayValue,
                }));

            return NextResponse.json({
                html: reportHtml,
                scores,
                metrics,
                opportunities,
                diagnostics,
                url: url,
                device: device,
                fetchTime: reportJson.fetchTime,
            });

        } catch (error: any) {
            console.error("Lighthouse execution error:", error);
            return NextResponse.json(
                { error: "Lighthouse analysis failed", detail: error?.stderr || error?.message },
                { status: 500 }
            );
        }
    } catch (error: any) {
        console.error("API error:", error);
        return NextResponse.json(
            { error: "Internal Server Error", detail: error?.message },
            { status: 500 }
        );
    }
}
