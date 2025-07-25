import { NextRequest, NextResponse } from "next/server";
import {
  getMarketChart,
  VALID_TIME_PERIODS,
  CHART_PERIODS,
} from "@/lib/priceService";

const ALLOWED_SYMBOLS = ["arweave", "ao-computer"];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = (searchParams.get("symbol") || "arweave").toLowerCase();
  const currency = (searchParams.get("currency") || "usd").toLowerCase();
  const days = searchParams.get("days") || "7";

  if (!VALID_TIME_PERIODS.includes(days)) {
    return NextResponse.json(
      {
        error: `Invalid time period. Must be one of: ${VALID_TIME_PERIODS.join(
          ", "
        )}`,
        validPeriods: CHART_PERIODS,
      },
      { status: 400 }
    );
  }

  if (!ALLOWED_SYMBOLS.includes(symbol)) {
    return NextResponse.json(
      {
        error: `Invalid symbol. Must be one of: ${ALLOWED_SYMBOLS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const chartData = await getMarketChart(symbol, currency, days);

    return NextResponse.json({
      symbol,
      currency,
      days,
      period: CHART_PERIODS[days],
      data: chartData,
      cacheAge: chartData.cacheAge,
      cachedAt: chartData.cachedAt,
      fresh: chartData.fresh,
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
      { error: `Failed to get ${symbol} market chart data: ${errorMessage}` },
      { status: 500 }
    );
  }
}
