import { dryrun } from "@permaweb/aoconnect";
import { redis } from "./redis";

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
const CACHE_EXPIRY = 86400; // 24 hours in seconds

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

/**
 * Find the value for a tag name
 */
export const getTagValue = (tagName: string, tags: Tag[]) =>
  tags.find((t) => t.name === tagName)?.value;

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
            Denomination: Number(Denomination || 0),
            Logo,
            type,
          };
        }
      } catch {}
    }
    const Ticker = getTagValue("Ticker", msg.Tags);
    const Name = getTagValue("Name", msg.Tags);
    const Denomination = getTagValue("Denomination", msg.Tags);
    const Logo = getTagValue("Logo", msg.Tags);
    const Transferable = getTagValue("Transferable", msg.Tags);

    if (!Ticker && !Name) continue;

    return {
      Name,
      Ticker,
      Denomination: Number(Denomination || 0),
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
    const res = await dryrun({
      process: tokenId,
      tags: [{ name: "Action", value: "Info" }],
    });

    const tokenInfo = getTokenInfoFromData(res, tokenId);

    if (!save) {
      // Cache the result
      await redis.set(
        cacheKey,
        { tokenInfo, timestamp: Date.now() },
        { ex: CACHE_EXPIRY }
      );
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
 */
export async function updateAllTokenInfos(
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<Record<string, TokenInfo>> {
  const results: Record<string, TokenInfo> = {};
  let failedUpdates: string[] = [];

  try {
    let cursor = 0;

    // Process tokens in batches
    while (true) {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: "tokenInfo:*",
        count: BATCH_SIZE,
      });
      cursor = parseInt(nextCursor, 10);

      const batchTokenIds = keys.map((key) => key.replace("tokenInfo:", ""));
      if (batchTokenIds.length === 0) {
        if (cursor === 0) break;
        continue;
      }

      // Process batch with progress tracking
      const batchResults = await Promise.allSettled(
        batchTokenIds.map(async (tokenId) => {
          try {
            const tokenInfo = await getTokenInfoFromAo(tokenId, false);

            return { success: true, tokenId, tokenInfo } as UpdateResult;
          } catch (error) {
            return {
              success: false,
              tokenId,
              error: error instanceof Error ? error.message : String(error),
            } as UpdateResult;
          }
        })
      );

      // Process batch results
      const batchFailedUpdates: string[] = [];
      const pipeline = redis.pipeline();

      batchResults.forEach((result) => {
        if (result.status === "fulfilled") {
          const { success, tokenId, tokenInfo, error } = result.value;
          if (success && tokenInfo) {
            results[tokenId] = tokenInfo;
            // Update cache in pipeline
            pipeline.set(
              `tokenInfo:${tokenId}`,
              { tokenInfo, timestamp: Date.now() },
              { ex: CACHE_EXPIRY }
            );
          } else {
            batchFailedUpdates.push(tokenId);
            console.error(
              `Failed to update token info for ${tokenId}: ${error}`
            );
          }
        }
      });

      // Execute pipeline for cache updates
      try {
        await pipeline.exec();
      } catch (error) {
        console.error("Error updating cache:", error);
      }

      failedUpdates.push(...batchFailedUpdates);

      // Add delay between batches to prevent rate limiting
      if (cursor !== 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (cursor === 0) break;
    }

    // Retry failed updates with exponential backoff
    if (failedUpdates.length > 0) {
      for (
        let attempt = 0;
        attempt < maxRetries && failedUpdates.length > 0;
        attempt++
      ) {
        const delay = retryDelay * Math.pow(2, attempt);
        console.log(
          `Retry attempt ${attempt + 1}/${maxRetries} for ${
            failedUpdates.length
          } tokens (delay: ${delay}ms)`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));

        const retryResults = await Promise.allSettled(
          failedUpdates.map(async (tokenId) => {
            try {
              const tokenInfo = await getTokenInfoFromAo(tokenId);
              return { success: true, tokenId, tokenInfo } as UpdateResult;
            } catch (error) {
              return {
                success: false,
                tokenId,
                error: error instanceof Error ? error.message : String(error),
              } as UpdateResult;
            }
          })
        );

        const newFailedUpdates: string[] = [];
        const retryPipeline = redis.pipeline();

        retryResults.forEach((result) => {
          if (result.status === "fulfilled") {
            const { success, tokenId, tokenInfo, error } = result.value;
            if (success && tokenInfo) {
              results[tokenId] = tokenInfo;
              retryPipeline.set(
                `tokenInfo:${tokenId}`,
                { tokenInfo, timestamp: Date.now() },
                { ex: CACHE_EXPIRY }
              );
            } else {
              newFailedUpdates.push(tokenId);
              console.error(
                `Failed to update token info for ${tokenId} (retry ${
                  attempt + 1
                }): ${error}`
              );
            }
          }
        });

        // Execute pipeline for retry cache updates
        try {
          await retryPipeline.exec();
        } catch (error) {
          console.error("Error updating cache during retry:", error);
        }

        failedUpdates = newFailedUpdates;
      }
    }

    // Log final results
    const successCount = Object.keys(results).length;
    const failureCount = failedUpdates.length;
    console.log(
      `Update completed: ${successCount} succeeded, ${failureCount} failed`
    );

    if (failedUpdates.length > 0) {
      console.error(
        `Failed to update token info after ${maxRetries} attempts for: ${failedUpdates.join(
          ", "
        )}`
      );
    }

    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update token infos: ${errorMessage}`);
    throw error;
  }
}
