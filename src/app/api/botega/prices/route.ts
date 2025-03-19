import { NextRequest, NextResponse } from "next/server";
import { getBotegaPrices } from "@/lib/botegaService";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenIds = searchParams.get("tokenIds");

  if (!tokenIds) {
    return NextResponse.json(
      { error: "Missing tokenIds parameter. Use ?tokenIds=id1,id2,id3" },
      { status: 400 }
    );
  }

  try {
    // Parse token IDs from the comma-separated list
    const tokenIdArray = tokenIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (tokenIdArray.length === 0) {
      return NextResponse.json(
        { error: "No valid token IDs provided" },
        { status: 400 }
      );
    }

    const priceData = await getBotegaPrices(tokenIdArray);

    return NextResponse.json({
      tokenIds: tokenIdArray,
      prices: priceData.prices,
      cacheInfo: priceData.cacheInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    // Properly handle errors
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    return NextResponse.json(
      { error: `Failed to get Botega prices: ${errorMessage}` },
      { status: 500 }
    );
  }
}
