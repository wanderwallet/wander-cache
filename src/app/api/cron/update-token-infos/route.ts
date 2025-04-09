import { NextRequest, NextResponse } from "next/server";
import { isSecretEqual } from "@/utils/secrets.utils";
import { updateAllTokenInfos } from "@/lib/tokenInfoService";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !CRON_SECRET || !isSecretEqual(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tokenInfos = await updateAllTokenInfos();

    return NextResponse.json({
      success: true,
      updatedAt: new Date().toISOString(),
      results: { tokenInfos },
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    console.error("Token info update failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to update token infos: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
