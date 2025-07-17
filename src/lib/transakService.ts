import "./polyfill";
import { redis } from "./redis";
import { aoInstance, createDataItemSigner } from "./aoconnect";
import { createHash } from "crypto";

interface TransakTokenData {
  accessToken: string;
  expiresAt: number; // Unix timestamp
}

interface TransakOrder {
  id: string;
  walletAddress: string;
  fiatAmountInUsd: number;
  partnerFeeInUsd: number;
  completedAt: string;
}

interface TransakOrderResponse {
  success: boolean;
  meta: {
    limit: number;
    skip: number;
    totalCount: number;
  };
  data: TransakOrder[];
}

interface TransakApiKey {
  id: "transak" | "transak-free";
  key: string;
  secret: string;
}

// API Keys
const TRANSAK_API_KEY = process.env.TRANSAK_API_KEY || "";
const TRANSAK_API_SECRET = process.env.TRANSAK_API_SECRET || "";
const TRANSAK_FREE_API_KEY = process.env.TRANSAK_FREE_API_KEY || "";
const TRANSAK_FREE_API_SECRET = process.env.TRANSAK_FREE_API_SECRET || "";

const TRANSAK_API_KEYS: TransakApiKey[] = [
  {
    id: "transak",
    key: TRANSAK_API_KEY,
    secret: TRANSAK_API_SECRET,
  },
  {
    id: "transak-free",
    key: TRANSAK_FREE_API_KEY,
    secret: TRANSAK_FREE_API_SECRET,
  },
];

const TRANSAK_ACCESS_TOKEN_PREFIX = "transak:access_token:";
const TOKEN_BUFFER_TIME = 5 * 60 * 1000; // 5 minutes buffer before expiry
const TRANSAK_FEE_PERCENT = 2.5;
const TRANSAK_UPDATER_PROCESS_ID =
  "1kebeITRKxp9fQIj1Q9h7Ozo27GSv085TC94spI9-CY"; // TODO: Change to production
const BASE_URL = "https://api-stg.transak.com/partners/api/v2"; // TODO: Change to production
// const BASE_URL = "https://api.transak.com/partners/api/v2";

const SECRET_SALT = process.env.SECRET_SALT || "default-salt";

function anonymizeUUID(uuid: string): string {
  const hash = createHash("sha256")
    .update(SECRET_SALT + uuid)
    .digest("base64url");

  return hash.slice(0, uuid.length);
}

/**
 * Get a valid Transak access token, refreshing if necessary
 * @returns Valid access token
 */
export async function getValidAccessToken(
  apiKey: TransakApiKey
): Promise<string> {
  // Check if we have a cached token
  const cachedToken = await redis.get<TransakTokenData>(
    `${TRANSAK_ACCESS_TOKEN_PREFIX}:${apiKey.id}`
  );

  if (cachedToken) {
    const timeUntilExpiry = cachedToken.expiresAt - Date.now();

    // If token is still valid with buffer time, return it
    if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
      console.log(
        `Using cached Transak token (expires in ${timeUntilExpiry / 1000}s)`
      );
      return cachedToken.accessToken;
    }

    console.log(
      `Transak token expires in ${timeUntilExpiry / 1000}s, refreshing...`
    );
  } else {
    console.log("No cached Transak token found, refreshing...");
  }

  // Token is expired or doesn't exist, refresh it
  return await refreshAccessToken(apiKey);
}

/**
 * Refresh the Transak access token
 * @returns New access token
 */
async function refreshAccessToken(apiKey: TransakApiKey): Promise<string> {
  if (!apiKey.secret || !apiKey.key) {
    throw new Error("Missing Transak API credentials");
  }

  const response = await fetch(`${BASE_URL}/refresh-token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-secret": apiKey.secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ apiKey: apiKey.key }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to refresh Transak token: ${response.status} ${response.statusText}`
    );
  }

  const { data } = await response.json();

  if (!data.accessToken) {
    throw new Error("Invalid response from Transak refresh token API");
  }

  const expiresAt = data.expiresAt * 1000;

  // Cache the new token
  const tokenData: TransakTokenData = {
    accessToken: data.accessToken,
    expiresAt,
  };

  const expiryInSeconds = Math.floor((expiresAt - Date.now()) / 1000);

  await redis.set(
    `${TRANSAK_ACCESS_TOKEN_PREFIX}:${apiKey.id}`,
    JSON.stringify(tokenData),
    { ex: expiryInSeconds }
  );

  console.log(
    `Transak token refreshed successfully (expires at ${new Date(
      expiresAt
    ).toISOString()})`
  );

  return data.accessToken;
}

/**
 * Get order status for partner orders
 * @param partnerOrderIds Array of partner order IDs
 * @returns Order status data
 */
export async function getOrder(
  partnerOrderId: string,
  apiKey: TransakApiKey
): Promise<TransakOrder> {
  const accessToken = await getValidAccessToken(apiKey);

  const response = await fetch(`${BASE_URL}/order/${partnerOrderId}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "access-token": accessToken,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get order status: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

export async function getOrders(
  apiKey: TransakApiKey
): Promise<TransakOrder[]> {
  const accessToken = await getValidAccessToken(apiKey);

  const now = new Date();
  const startDate = new Date(now.getTime() - 60 * 60 * 24 * 1000);
  const startDateString = startDate.toISOString().split("T")[0];
  const endDateString = now.toISOString().split("T")[0];

  const response = await fetch(
    `${BASE_URL}/orders?limit=100&skip=0&startDate=${startDateString}&endDate=${endDateString}&filter[productsAvailed]=%5B%22BUY%22%5D&filter[status]=COMPLETED&filter[sortOrder]=desc`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "access-token": accessToken,
      },
    }
  );

  const { data } = (await response.json()) as TransakOrderResponse;

  return data;
}

export async function processOrder(order: TransakOrder, apiKey: TransakApiKey) {
  const isOrderProcessed = await redis.get(`transak:processed:${order.id}`);
  if (isOrderProcessed) return;

  const savings =
    apiKey.id === "transak-free"
      ? ((TRANSAK_FEE_PERCENT * order.fiatAmountInUsd) / 100)
          .toFixed(8)
          .replace(/\.?0+$/, "")
      : "0";

  await updateFeeSavings(
    order.id,
    order.walletAddress,
    savings,
    order.partnerFeeInUsd.toString()
  );
}

export async function processOrdersWithApiKey(apiKey: TransakApiKey) {
  if (!apiKey.key || !apiKey.secret) {
    throw new Error("API key or secret is not set");
  }

  const orders = await getOrders(apiKey);
  const results = await Promise.allSettled(
    orders.map((order) => processOrder(order, apiKey))
  );

  const failed = results.filter((result) => result.status === "rejected");
  const failedCount = failed.length;
  const totalCount = results.length;

  console.log(
    `Processed ${totalCount} orders, ${failedCount} failed, ${
      totalCount - failedCount
    } succeeded`
  );
}

export async function processOrders() {
  for (const apiKey of TRANSAK_API_KEYS) {
    try {
      await processOrdersWithApiKey(apiKey);
    } catch (error) {
      console.error(
        `Error processing orders with API key ${apiKey.id}:`,
        error
      );
    }
  }
}

async function updateFeeSavings(
  orderId: string,
  walletAddress: string,
  savings: string,
  fees: string
) {
  try {
    const wallet = process.env.WALLET;
    if (!wallet) throw new Error("WALLET is not set");

    const keyfile = JSON.parse(wallet);
    const signer = createDataItemSigner(keyfile);

    await aoInstance.message({
      process: TRANSAK_UPDATER_PROCESS_ID,
      signer,
      tags: [
        { name: "Action", value: "Add-Savings" },
        { name: "Target", value: walletAddress },
        { name: "Fee-Savings", value: savings },
        { name: "Fee-Applied", value: fees },
        { name: "Order-Id", value: anonymizeUUID(orderId) },
      ],
    });

    await redis.set(`transak:processed:${orderId}`, true, {
      ex: 60 * 60 * 24 * 3,
    }); // 3 days expiry
  } catch (error) {
    console.error(error);
  }
}
