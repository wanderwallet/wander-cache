import { NextRequest, NextResponse } from "next/server";
import { getPrice } from "@/lib/priceService";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get("symbol") || "arweave";
  const currency = searchParams.get("currency") || "usd";

  try {
    const priceData = await getPrice(symbol, currency);
    return NextResponse.json({
      symbol,
      currency,
      price: priceData.price,
      fresh: priceData.fresh,
      cachedAt: priceData.cachedAt,
      cacheAge: priceData.cacheAge,
      timestamp: new Date().toISOString()
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
      { error: `Failed to get price: ${errorMessage}` },
      { status: 500 }
    );
  }
}
