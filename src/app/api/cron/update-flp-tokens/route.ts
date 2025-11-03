import { NextRequest, NextResponse } from "next/server";
import { updateFlpTokens } from "@/lib/flpTokenService";
import { isSecretEqual } from "@/utils/secrets.utils";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !CRON_SECRET || !isSecretEqual(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Update FLP tokens
    await updateFlpTokens();

    return NextResponse.json({
      success: true,
      runAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    console.error("FLP tokens update failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to update FLP tokens: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
