import { NextRequest, NextResponse } from "next/server";
import { isSecretEqual } from "@/utils/secrets.utils";
import { aoInstance, createDataItemSigner } from "@/lib/aoconnect";

const CRON_SECRET = process.env.CRON_SECRET;
const WALLET = process.env.WALLET as string;

const vesting = {
  unlockIntervalMs: 2592000000, // 30 days
  totalTranches: 37,
  startTimeMs: 1759334923437, // 2025-10-01T16:08:43.437Z
};

const WNDR_PROCESS_ID = "7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

async function triggerVesting(trancheIndex: number) {
  console.log(`✅ Vesting triggered for tranche ${trancheIndex + 1}`);

  try {
    const keyfile = JSON.parse(WALLET);
    const signer = createDataItemSigner(keyfile);

    const messageId = await aoInstance.message({
      process: WNDR_PROCESS_ID,
      signer,
      tags: [{ name: "Action", value: "Vesting-Trigger" }],
    });

    console.log(`📝 Message sent with ID: ${messageId}`);
    return messageId;
  } catch (error) {
    console.error(
      `❌ Failed to trigger vesting for tranche ${trancheIndex + 1}:`,
      error
    );
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !CRON_SECRET || !isSecretEqual(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!WALLET) {
      return NextResponse.json({ error: "WALLET is not set" }, { status: 400 });
    }

    const start = vesting.startTimeMs;
    const interval = vesting.unlockIntervalMs;
    const total = vesting.totalTranches;
    const now = Date.now();

    const trancheIndex = Math.floor((now - start) / interval);
    if (trancheIndex >= total) {
      return NextResponse.json({ status: "completed" });
    }

    const unlockTime = start + trancheIndex * interval;
    const nextUnlock = unlockTime + interval;

    if (now >= unlockTime && now - unlockTime < ONE_DAY_IN_MS) {
      await triggerVesting(trancheIndex);
      return NextResponse.json({
        status: "triggered",
        tranche: trancheIndex + 1,
      });
    }

    return NextResponse.json({
      status: "skipped",
      nextUnlock: new Date(nextUnlock).toISOString(),
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    console.error("Vesting trigger failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to trigger vesting: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
