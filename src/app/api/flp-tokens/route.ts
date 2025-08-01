import { NextResponse } from "next/server";
import { getFlpTokens } from "@/lib/flpTokenService";

export async function GET() {
  try {
    const flpTokensData = await getFlpTokens();
    return NextResponse.json({
      flpTokens: flpTokensData.flpTokens,
      fresh: flpTokensData.fresh,
      cachedAt: flpTokensData.cachedAt,
      cacheAge: flpTokensData.cacheAge,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    return NextResponse.json(
      { error: `Failed to get token info: ${errorMessage}` },
      { status: 500 }
    );
  }
}
