import { NextRequest, NextResponse } from "next/server";
import { updateSingleBotegaPrice } from "@/lib/botegaService";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenId = searchParams.get("tokenId");

  if (!tokenId) {
    return NextResponse.json(
      { error: "Missing tokenId parameter. Use ?tokenId=yourTokenId" },
      { status: 400 }
    );
  }

  try {
    const price = await updateSingleBotegaPrice(tokenId);

    return NextResponse.json({
      tokenId,
      price,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch (jsonError) {
      errorMessage = String(error);
    }

    return NextResponse.json(
      { error: `Failed to get Botega price: ${errorMessage}` },
      { status: 500 }
    );
  }
}