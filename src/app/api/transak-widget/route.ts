import { NextRequest, NextResponse } from "next/server";
import { createTransakWidgetUrl } from "@/lib/transakService";

export async function POST(request: NextRequest) {
  const requestJson = await request.json();

  if (
    !requestJson.widgetParams ||
    typeof requestJson.widgetParams !== "object"
  ) {
    return NextResponse.json(
      { error: "Missing widgetParams object" },
      { status: 400 }
    );
  }

  try {
    const widgetUrl = await createTransakWidgetUrl(
      requestJson.widgetParams,
      // request.nextUrl.host
      "wander.app"
    );
    return NextResponse.json({ widgetUrl });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    return NextResponse.json(
      { error: `Failed to create widget URL: ${errorMessage}` },
      { status: 500 }
    );
  }
}
