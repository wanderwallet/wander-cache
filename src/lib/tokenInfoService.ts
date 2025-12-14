import "./polyfill";
import { aoInstance } from "./aoconnect";
import { redis } from "./redis";
import pLimit from "p-limit";
import pRetry from "p-retry";
import { getTokenChunk, getTodayChunk } from "@/utils/chunk.utils";

export interface TokenInfo {
  Name?: string;
  Ticker?: string;
  Logo?: string;
  Denomination: number;
  type?: "asset" | "collectible";
}

// Define the cached price data structure
interface CachedTokenInfoData {
  tokenInfo: TokenInfo;
  timestamp: number;
}

// Define AO response types
interface AoResponse {
  Messages: Message[];
}

export interface Message {
  Anchor: string;
  Tags: Tag[];
  Target: string;
  Data: string;
}

export interface Tag {
  name: string;
  value: string;
}

export interface TokenInfoResponse {
  tokenInfo: TokenInfo;
  fresh: boolean;
  cachedAt?: string;
  cacheAge?: number;
}

const BATCH_SIZE = 100;

/**
 * Get token info with caching
 */
export async function getTokenInfo(
  tokenId: string,
  save: boolean = true
): Promise<TokenInfoResponse> {
  const cacheKey = `tokenInfo:${tokenId}`;

  try {
    // Cache first
    const cachedTokenInfo = await redis.get<CachedTokenInfoData>(cacheKey);

    if (cachedTokenInfo) {
      const { tokenInfo, timestamp } = cachedTokenInfo;
      const now = Date.now();
      const cacheAge = Math.floor((now - timestamp) / 1000);

      return {
        tokenInfo,
        fresh: true,
        cachedAt: new Date(timestamp).toISOString(),
        cacheAge,
      };
    }
  } catch (error) {
    console.error(`Error reading cache for ${tokenId}:`, error);
  }

  // If not in cache or error, fetch from AO
  try {
    const tokenInfo = await getTokenInfoFromAo(tokenId, save);
    return {
      tokenInfo,
      fresh: true,
      cachedAt: new Date().toISOString(),
      cacheAge: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch token info for ${tokenId}: ${errorMessage}`
    );
  }
}

function getTokenInfoFromData(res: AoResponse, id: string): TokenInfo {
  // find message with token info
  for (const msg of res.Messages) {
    if (msg?.Data) {
      try {
        const data = JSON.parse(msg.Data);
        const Ticker = data.Ticker || data.ticker;
        const Name = data.Name || data.name;
        const Denomination = data.Denomination || data.denomination;
        const Logo = data.Logo || data.logo || id;
        const type =
          typeof data?.transferable === "boolean" ||
          typeof data?.Transferable === "boolean" ||
          Ticker === "ATOMIC"
            ? "collectible"
            : "asset";

        if (Ticker && Name) {
          return {
            Ticker,
            Name,
            Denomination: Number(Denomination) || 0,
            Logo,
            type,
          };
        }
      } catch {}
    }

    let Ticker, Name, Denomination, Logo, Transferable;

    for (let i = 0; i < msg.Tags.length; i++) {
      const tag = msg.Tags[i];
      const name = tag.name.toLowerCase();
      const value = tag.value;

      switch (name) {
        case "ticker":
          Ticker ??= value;
          break;
        case "name":
          Name ??= value;
          break;
        case "denomination":
          Denomination ??= value;
          break;
        case "logo":
          Logo ??= value;
          break;
        case "transferable":
          Transferable ??= value;
          break;
      }
    }

    if (!Ticker && !Name) continue;

    return {
      Name,
      Ticker,
      Denomination: Number(Denomination) || 0,
      Logo,
      type: Transferable || Ticker === "ATOMIC" ? "collectible" : "asset",
    };
  }

  throw new Error("Could not load token info.");
}

export async function getTokenInfoFromAo(
  tokenId: string,
  save: boolean = true
): Promise<TokenInfo> {
  const cacheKey = `tokenInfo:${tokenId}`;

  try {
    // query ao
    const res = await aoInstance.dryrun({
      process: tokenId,
      tags: [{ name: "Action", value: "Info" }],
    });

    const tokenInfo = getTokenInfoFromData(res, tokenId);

    if (save) {
      // Cache the result
      await redis.set(cacheKey, { tokenInfo, timestamp: Date.now() });
    }

    return tokenInfo;
  } catch (error) {
    console.error(`Error fetching token info for ${tokenId}:`, error);
    throw error;
  }
}

interface UpdateResult {
  success: boolean;
  tokenId: string;
  tokenInfo?: TokenInfo;
  error?: string;
}

/**
 * Update token info for all tokens in Redis cache
 * Only updates tokens in the chunk corresponding to the current day
 */
export async function updateAllTokenInfos(
  maxRetries = 3,
  retryDelay = 1000,
  concurrency = 10,
  numChunks = 4
): Promise<Record<string, TokenInfo>> {
  const results: Record<string, TokenInfo> = {};
  const limit = pLimit(concurrency);

  const todayChunk = getTodayChunk(numChunks);

  console.log(`Updating token infos for chunk ${todayChunk}/${numChunks}`);

  try {
    let cursor = "0";
    const failedUpdates: string[] = [];
    let totalTokens = 0;
    let processedTokens = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: "tokenInfo:*",
        count: BATCH_SIZE,
      });
      cursor = String(nextCursor);

      const batchTokenIds = keys.map((k) => k.slice("tokenInfo:".length));
      totalTokens += batchTokenIds.length;

      // Filter tokens for today's chunk
      const tokensToProcess = batchTokenIds.filter(
        (id) => getTokenChunk(id, numChunks) === todayChunk
      );
      processedTokens += tokensToProcess.length;

      if (tokensToProcess.length === 0) continue;

      const batchResults = await Promise.allSettled(
        tokensToProcess.map((tokenId) =>
          limit(async () => {
            try {
              const tokenInfo = await pRetry(
                () => getTokenInfoFromAo(tokenId, false),
                {
                  retries: maxRetries,
                  factor: 2,
                  minTimeout: retryDelay,
                  maxTimeout: retryDelay * 3,
                }
              );
              return { success: true, tokenId, tokenInfo } as UpdateResult;
            } catch (error) {
              return {
                success: false,
                tokenId,
                error: error instanceof Error ? error.message : String(error),
              } as UpdateResult;
            }
          })
        )
      );

      // Write to Redis pipeline
      const pipeline = redis.pipeline();
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          const { success, tokenId, tokenInfo, error } = result.value;
          if (success && tokenInfo) {
            results[tokenId] = tokenInfo;
            pipeline.set(`tokenInfo:${tokenId}`, {
              tokenInfo,
              timestamp: Date.now(),
            });
          } else {
            failedUpdates.push(tokenId);
            console.error(`Failed to update ${tokenId}: ${error}`);
          }
        }
      }
      try {
        await pipeline.exec();
      } catch (error) {
        console.error("Error updating cache:", error);
      }
    } while (cursor !== "0");

    console.log(
      `Chunk ${todayChunk}/${numChunks} update completed: ${
        Object.keys(results).length
      } succeeded, ${
        failedUpdates.length
      } failed (processed ${processedTokens}/${totalTokens} tokens)`
    );

    if (failedUpdates.length > 0) {
      console.error(
        `Failed after ${maxRetries} retries: ${failedUpdates.join(", ")}`
      );
    }

    return results;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to update token infos: ${errorMessage}`);
    throw err;
  }
}
