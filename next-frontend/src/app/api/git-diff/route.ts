import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(req: NextRequest) {
    try {
        const { filePath } = await req.json();

        if (!filePath) {
            return NextResponse.json({ error: "File path is required" }, { status: 400 });
        }

        const themePath = "/var/www/html/shopify-ai-optimizer/ella-bella";

        // Get git diff for the specific file
        try {
            // Use --no-pager and --color=never for clean output
            const diff = execSync(`git -C ${themePath} diff HEAD ${filePath}`, { encoding: "utf8" });
            return NextResponse.json({ diff: diff || "No changes detected in Git." });
        } catch (err: any) {
            // If git diff fails (e.g. file not in git yet), try to get status or just return error
            return NextResponse.json({ error: "Could not retrieve git diff", detail: err.message }, { status: 500 });
        }

    } catch (error: any) {
        return NextResponse.json({ error: "Internal server error", detail: error.message }, { status: 500 });
    }
}
