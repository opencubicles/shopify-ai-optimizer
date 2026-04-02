import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const FIXES_FILE = path.join(DATA_DIR, "generated-fixes.json");

export async function GET(_req: NextRequest) {
    try {
        if (!fs.existsSync(FIXES_FILE)) {
            return NextResponse.json({
                ready: false,
                message: "No fixes generated yet. Run a PageSpeed audit first, then ask the AI to generate fixes."
            }, { status: 404 });
        }

        const content = fs.readFileSync(FIXES_FILE, "utf8");
        const fixes = JSON.parse(content);
        const stat = fs.statSync(FIXES_FILE);

        return NextResponse.json({
            ready: true,
            generatedAt: stat.mtime,
            ...fixes
        });
    } catch (error: any) {
        return NextResponse.json({ error: "Failed to load fixes", detail: error.message }, { status: 500 });
    }
}
