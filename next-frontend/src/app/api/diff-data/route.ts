import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
    try {
        const { filePath } = await req.json();

        if (!filePath) {
            return NextResponse.json({ error: "File path is required" }, { status: 400 });
        }

        const themePath = process.env.THEME_PATH || path.join(process.cwd(), "..", "theme");
        const fullPath = path.join(themePath, filePath);

        if (!fs.existsSync(fullPath)) {
            return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
        }

        // Step 1: Check if there are uncommitted changes on disk for this file
        const isModified = execSync(`git -C ${themePath} status --porcelain ${filePath}`, { encoding: "utf8" }).trim();

        let oldCode = "";
        let newCode = "";

        if (isModified) {
            // Case A: Uncommitted changes. Compare HEAD vs DISK.
            try {
                oldCode = execSync(`git -C ${themePath} show HEAD:${filePath}`, { encoding: "utf8" });
            } catch (e) {
                oldCode = ""; // New file
            }
            newCode = fs.readFileSync(fullPath, "utf8");
        } else {
            // Case B: Changes are committed. Compare HEAD~1 vs HEAD.
            try {
                oldCode = execSync(`git -C ${themePath} show HEAD~1:${filePath}`, { encoding: "utf8" });
                newCode = execSync(`git -C ${themePath} show HEAD:${filePath}`, { encoding: "utf8" });
            } catch (e) {
                // Fallback: If no HEAD~1, just show current
                oldCode = "";
                newCode = fs.readFileSync(fullPath, "utf8");
            }
        }

        return NextResponse.json({ oldCode, newCode, fileName: filePath, status: isModified ? "uncommitted" : "committed" });

    } catch (error: any) {
        console.error("Diff Data error:", error);
        return NextResponse.json({ error: "Failed to get diff data", detail: error.message }, { status: 500 });
    }
}
