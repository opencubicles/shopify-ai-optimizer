import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { url, device = "mobile" } = await req.json();

        if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });

        const apiKey = process.env.PAGESPEED_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "PAGESPEED_KEY is missing in .env" }, { status: 500 });

        console.log(`Analyzing via PageSpeed API: ${url} (${device})`);

        // Categories to include
        const categories = "category=performance&category=accessibility&category=best-practices&category=seo";
        const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=${device.toUpperCase()}&${categories}`;

        const response = await fetch(psiUrl);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || "PageSpeed API failed");
        }

        const reportJson = data.lighthouseResult;

        // Extract scores
        const scores = {
            performance: Math.round((reportJson?.categories?.performance?.score || 0) * 100),
            accessibility: Math.round((reportJson?.categories?.accessibility?.score || 0) * 100),
            bestPractices: Math.round((reportJson?.categories?.["best-practices"]?.score || 0) * 100),
            seo: Math.round((reportJson?.categories?.seo?.score || 0) * 100),
        };

        // Extract core metrics with safety fallbacks
        const extractMetric = (auditId: string, camelId?: string) => {
            // Priority 1: Direct Audit
            const audit = reportJson?.audits?.[auditId];
            if (audit && (audit.displayValue || audit.numericValue)) {
                return audit.displayValue || `${Math.round(audit.numericValue * 100) / 100}`;
            }

            // Priority 2: 'metrics' Audit Items (Fallback for PageSpeed API quirks)
            const metricsAudit = reportJson?.audits?.["metrics"];
            const item = metricsAudit?.details?.items?.[0];
            if (item && camelId && item[camelId]) {
                const val = item[camelId];
                return val > 1000 ? `${(val / 1000).toFixed(2)} s` : `${Math.round(val)} ms`;
            }

            return "--";
        };

        const metrics = {
            fcp: extractMetric("first-contentful-paint", "firstContentfulPaint"),
            lcp: extractMetric("largest-contentful-paint", "largestContentfulPaint"),
            tbt: extractMetric("total-blocking-time", "totalBlockingTime"),
            cls: extractMetric("cumulative-layout-shift", "cumulativeLayoutShift"),
            si: extractMetric("speed-index", "speedIndex"),
            tti: extractMetric("interactive", "interactive"),
        };

        // Extract opportunities (scored < 1)
        const opportunities = Object.values(reportJson.audits || {})
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
                displayValue: audit.displayValue || (audit.numericValue ? `${Math.round(audit.numericValue)}ms` : "--"),
                savings: audit.details?.overallSavingsMs || 0,
                details: audit.details
            }))
            .sort((a, b) => b.savings - a.savings);

        // Extract diagnostics (exclude metrics and opportunities)
        const diagnosticExclusions = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index", "interactive"];
        const diagnostics = Object.values(reportJson.audits || {})
            .filter((audit: any) => {
                return (
                    audit.score < 1 &&
                    audit.score !== null &&
                    !audit.details?.type &&
                    !diagnosticExclusions.includes(audit.id)
                );
            })
            .sort((a: any, b: any) => (a.score || 0) - (b.score || 0))
            .slice(0, 15) // Top 15 diagnostics
            .map((audit: any) => ({
                id: audit.id,
                title: audit.title,
                description: audit.description,
                displayValue: audit.displayValue || "",
            }));

        return NextResponse.json({
            html: "", // PageSpeed API doesn't return full HTML report by default
            scores,
            metrics,
            opportunities,
            diagnostics,
            url: url,
            device: device,
            fetchTime: reportJson.fetchTime,
        });

    } catch (error: any) {
        console.error("Analysis error:", error);
        return NextResponse.json(
            { error: "PageSpeed Analysis failed", detail: error.message },
            { status: 500 }
        );
    }
}
