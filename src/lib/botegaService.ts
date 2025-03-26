import "./polyfill";
import { redis } from "./redis";
import { dryrun } from "@permaweb/aoconnect";

// Define the cached price data structure
interface CachedBotegaPriceData {
  price: number | null;
  timestamp: number;
}

/**
 * Get Botega prices with caching
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices with cache metadata
 */
export interface BotegaPriceResponse {
  prices: Record<string, number | null>;
  cacheInfo: Record<
    string,
    {
      cachedAt: number;
    }
  >;
}

export async function getBotegaPrices(
  tokenIds: string[],
  forceRefresh: boolean = false
): Promise<BotegaPriceResponse> {
  // Get unique token IDs
  const uniqueTokenIds = [...new Set(tokenIds)];

  // Check if we have each token in cache
  const result: Record<string, number | null> = {};
  const cacheInfo: Record<string, { cachedAt: number }> = {};
  const tokensToFetch: string[] = [];

  // Try to get each token from cache
  const cachePromises = uniqueTokenIds.map(async (tokenId) => {
    const cacheKey = `botega:price:${tokenId}`;
    const cachedPrice = await redis.get<CachedBotegaPriceData>(cacheKey);

    if (cachedPrice && !forceRefresh) {
      const now = Date.now();
      const cacheAge = Math.floor((now - cachedPrice.timestamp) / 1000);
      const isFresh = cacheAge < 5 * 60; // 5 minutes freshness

      result[tokenId] = cachedPrice.price;
      cacheInfo[tokenId] = {
        cachedAt: cachedPrice.timestamp,
      };

      if (!isFresh) {
        tokensToFetch.push(tokenId);
      }
    } else {
      tokensToFetch.push(tokenId);
    }
  });

  // Wait for all cache lookups to complete
  await Promise.all(cachePromises);

  // If we have tokens that need fetching, get them from Botega
  if (tokensToFetch.length > 0) {
    try {
      const fetchedPrices = await fetchBotegaPrices(tokensToFetch);
      const now = Date.now();

      // Cache each token price individually and add to result
      const cacheOperations = Object.entries(fetchedPrices).map(
        ([tokenId, price]) => {
          const cacheKey = `botega:price:${tokenId}`;

          result[tokenId] = price;
          cacheInfo[tokenId] = {
            cachedAt: now,
          };

          return redis.set(
            cacheKey,
            {
              price,
              timestamp: now,
            },
            { ex: 86400 } // 24 hours
          );
        }
      );

      // Execute all cache operations
      await Promise.all(cacheOperations);
    } catch (error) {
      // If fetch fails, set null for all uncached tokens that don't have a cache entry yet
      console.error("Error fetching Botega prices:", error);
      tokensToFetch.forEach((tokenId) => {
        if (!result[tokenId]) {
          result[tokenId] = null;
          cacheInfo[tokenId] = {
            cachedAt: Date.now(),
          };
        }
      });
    }
  }

  return {
    prices: result,
    cacheInfo,
  };
}

/**
 * Fetch Botega prices from the API
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchBotegaPrices(
  tokenIds: string[]
): Promise<Record<string, number | null>> {
  try {
    const res = await dryrun({
      process: "Meb6GwY5I9QN77F0c5Ku2GpCFxtYyG1mfJus2GWYtII",
      data: "",
      tags: [
        {
          name: "Action",
          value: "Get-Price-For-Tokens",
        },
        {
          name: "Tokens",
          value: JSON.stringify(tokenIds),
        },
      ],
    });

    const pricesTag = res.Messages[0].Tags.find(
      (tag: DryRunTag) => tag.name === "Prices"
    );
    if (!pricesTag?.value)
      return Object.fromEntries(tokenIds.map((id) => [id, null]));

    const prices: Record<string, number | null> = {};
    try {
      const parsedValue =
        typeof pricesTag.value === "string"
          ? JSON.parse(pricesTag.value)
          : pricesTag.value;

      Object.entries(parsedValue).forEach((entry) => {
        const tokenId = entry[0];
        const data = entry[1] as { price?: number };
        prices[tokenId] = data.price || null;
      });
    } catch (e) {
      console.error("Error parsing price data:", e);
      return Object.fromEntries(tokenIds.map((id) => [id, null]));
    }

    return prices;
  } catch (error) {
    console.error("Error fetching Botega prices:", error);
    return Object.fromEntries(tokenIds.map((id) => [id, null]));
  }
}

export const TRACKED_BOTEGA_TOKENS = [
  "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10",
  "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc",
  "NG-0lVX882MG5nhARrSzyprEK6ejonHpdUmaaMPsHE8",
];

/**
 * Update prices for all tracked Botega tokens
 * @param maxRetries Maximum number of retry attempts (default: 3)
 * @param retryDelay Delay between retries in ms (default: 1000)
 * @returns Object with update results including cache information
 */
export async function updateAllBotegaPrices(
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<BotegaPriceResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // On first attempt or subsequent retries
      const priceData = await getBotegaPrices(TRACKED_BOTEGA_TOKENS, true);

      // Check if we got prices for all tokens
      const missingPrices = TRACKED_BOTEGA_TOKENS.filter(
        (tokenId) => priceData.prices[tokenId] === null
      );

      if (missingPrices.length === 0 || attempt === maxRetries) {
        return priceData;
      }

      // If we have missing prices and retries left, wait and try again
      console.log(
        `Retry ${attempt + 1}/${maxRetries}: Missing prices for ${
          missingPrices.length
        } tokens`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    } catch (error) {
      lastError = error;
      console.error(
        `Botega price update attempt ${attempt + 1}/${maxRetries} failed:`,
        error
      );

      if (attempt < maxRetries) {
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error(
    "Failed to update Botega prices after all retry attempts:",
    lastError
  );
  return { prices: {}, cacheInfo: {} };
}

interface DryRunTag {
  name: string;
  value: string | Record<string, unknown>;
}
