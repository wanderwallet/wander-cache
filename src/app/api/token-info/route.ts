import { NextRequest, NextResponse } from "next/server";
import { getTokenInfo } from "@/lib/tokenInfoService";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenId = searchParams.get("tokenId");

  if (!tokenId) {
    return NextResponse.json({ error: "tokenId is required" }, { status: 400 });
  }

  try {
    const tokenInfoData = await getTokenInfo(tokenId);
    return NextResponse.json({
      tokenId,
      tokenInfo: tokenInfoData.tokenInfo,
      fresh: tokenInfoData.fresh,
      cachedAt: tokenInfoData.cachedAt,
      cacheAge: tokenInfoData.cacheAge,
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
