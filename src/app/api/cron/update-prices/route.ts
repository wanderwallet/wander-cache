import { NextRequest, NextResponse } from "next/server";
import { updateAllPrices } from "@/lib/priceService";
import {
  updateAllBotegaPrices,
  TRACKED_BOTEGA_TOKENS,
} from "@/lib/botegaService";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || token !== CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Update prices in parallel
    const [cryptoResults, botegaResults] = await Promise.all([
      updateAllPrices(),
      TRACKED_BOTEGA_TOKENS.length > 0
        ? updateAllBotegaPrices()
        : Promise.resolve({}),
    ]);

    return NextResponse.json({
      success: true,
      updatedAt: new Date().toISOString(),
      results: {
        crypto: cryptoResults,
        botega: botegaResults,
      },
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch (jsonError) {
      errorMessage = String(error);
    }

    console.error("Price update failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to update prices: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
