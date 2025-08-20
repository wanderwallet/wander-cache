import { getWalletsTierInfo } from "@/lib/tier";
import { isArweaveAddress } from "@/utils/address.utils";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get("address") as string;
  const addresses = searchParams.get("addresses") as string;

  if (!address && !addresses) {
    return NextResponse.json(
      {
        error:
          "Missing address or addresses parameter. Use ?address=id1 or ?addresses=id1,id2,id3",
      },
      { status: 400 }
    );
  }

  try {
    let addressesArray = address
      ? [address]
      : addresses
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);

    addressesArray = addressesArray.filter(isArweaveAddress);

    if (addressesArray.length === 0) {
      return NextResponse.json(
        { error: "No valid addresses provided" },
        { status: 400 }
      );
    }

    const walletsInfo = await getWalletsTierInfo(addressesArray);
    const responseJson = address ? walletsInfo[address] : walletsInfo;

    return NextResponse.json(responseJson);
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
      { error: `Failed to get tier info: ${errorMessage}` },
      { status: 500 }
    );
  }
}
