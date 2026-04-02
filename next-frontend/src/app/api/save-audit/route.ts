import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const AUDIT_FILE = path.join(DATA_DIR, "audit-result.json");

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(AUDIT_FILE, JSON.stringify(body, null, 2), "utf8");
        console.log("[save-audit] Audit saved to", AUDIT_FILE);
        return NextResponse.json({ success: true, path: AUDIT_FILE });
    } catch (error: any) {
        return NextResponse.json({ error: "Failed to save audit", detail: error.message }, { status: 500 });
    }
}
