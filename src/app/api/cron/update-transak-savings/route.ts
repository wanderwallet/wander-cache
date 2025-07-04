import { NextRequest, NextResponse } from "next/server";
import { processOrders } from "@/lib/transakService";
import { isSecretEqual } from "@/utils/secrets.utils";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !CRON_SECRET || !isSecretEqual(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Update prices in parallel
    await processOrders();

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

    console.error("Transak fee savings update failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to update transak fee savings: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
