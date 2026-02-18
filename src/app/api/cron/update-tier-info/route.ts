import { NextRequest, NextResponse } from "next/server";
import { isSecretEqual } from "@/utils/secrets.utils";
import { aoInstance, createDataItemSigner } from "@/lib/aoconnect";

const CRON_SECRET = process.env.CRON_SECRET;
const WALLET = process.env.WALLET as string;

const SNAPSHOT_PROCESS_ID = "rkAezEIgacJZ_dVuZHOKJR8WKpSDqLGfgPJrs_Es7CA";

async function generateSnapshot() {
  try {
    const keyfile = JSON.parse(WALLET);
    const signer = createDataItemSigner(keyfile);

    const messageId = await aoInstance.message({
      process: SNAPSHOT_PROCESS_ID,
      signer,
      tags: [{ name: "Action", value: "Generate-Snapshot" }],
    });

    console.log(`📝 Message sent with ID: ${messageId}`);
    return messageId;
  } catch (error) {
    console.error(`❌ Failed to generate snapshot:`, error);
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

    await generateSnapshot();

    return NextResponse.json({
      success: true,
      runAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    let errorMessage;
    try {
      errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }

    console.error("Snapshot generation failed:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: `Failed to generate snapshot: ${errorMessage}`,
      },
      { status: 500 },
    );
  }
}
