import { NextRequest, NextResponse } from "next/server";
import { getFlpTokens } from "@/lib/flpTokenService";

export async function GET(request: NextRequest) {
  try {
    const flpTokensData = await getFlpTokens();

    // ETag for conditional requests
    const currentETag = `"${flpTokensData.cachedAt}"`;
    const ifNoneMatch = request.headers.get("if-none-match");

    if (ifNoneMatch === currentETag) {
      return new NextResponse(null, { status: 304 });
    }

    const response = NextResponse.json({
      flpTokens: flpTokensData.flpTokens,
      fresh: flpTokensData.fresh,
      cachedAt: flpTokensData.cachedAt,
      cacheAge: flpTokensData.cacheAge,
      timestamp: new Date().toISOString(),
    });

    // Caching strategy:
    // - Browser: 1h
    // - CDN: 24h + 1h stale-while-revalidate
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600"
    );
    response.headers.set("ETag", currentETag);

    return response;
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
