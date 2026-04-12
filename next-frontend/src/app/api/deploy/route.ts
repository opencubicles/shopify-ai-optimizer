import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
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
        const result = await callPatcher({ action: "deploy" });

        return NextResponse.json({
            success: result.success,
            message: result.message,
            merged: result.merged || [],
            conflicts: result.conflicts || [],
            branch: result.branch || "deploy"
        });

    } catch (e: any) {
        console.error("Deploy Error:", e);
        return NextResponse.json(
            { error: `Deploy failed: ${e.message}` },
            { status: 500 }
        );
    }
}

// GET to check deploy status
export async function GET(_req: NextRequest) {
    try {
        const result = await callPatcher({ action: "status" });
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json(
            { error: `Status check failed: ${e.message}` },
            { status: 500 }
        );
    }
}
