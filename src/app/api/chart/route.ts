import { NextRequest, NextResponse } from "next/server";
import { getMarketChart, VALID_TIME_PERIODS, CHART_PERIODS } from "@/lib/priceService";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const currency = searchParams.get("currency") || "usd";
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

  try {
    const chartData = await getMarketChart(currency, days);

    return NextResponse.json({
      symbol: "arweave",
      currency,
      days,
      period: CHART_PERIODS[days],
      data: chartData,
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
      { error: `Failed to get Arweave market chart data: ${errorMessage}` },
      { status: 500 }
    );
  }
}
