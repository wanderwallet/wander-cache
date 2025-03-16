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
 * @returns Record of token IDs to prices
 */
export async function getBotegaPrices(
  tokenIds: string[]
): Promise<Record<string, number | null>> {
  // Get unique token IDs
  const uniqueTokenIds = [...new Set(tokenIds)];

  // Check if we have each token in cache
  const result: Record<string, number | null> = {};
  const tokensToFetch: string[] = [];

  // Try to get each token from cache
  const cachePromises = uniqueTokenIds.map(async (tokenId) => {
    const cacheKey = `botega:price:${tokenId}`;
    const cachedPrice = await redis.get<CachedBotegaPriceData>(cacheKey);

    if (
      cachedPrice /* && Date.now() - cachedPrice.timestamp < 5 * 60 * 1000 */
    ) {
      // If we have a valid cache entry, use it (freshness check disabled)
      result[tokenId] = cachedPrice.price;
    } else {
      // Otherwise mark for fetching
      tokensToFetch.push(tokenId);
    }
  });

  // Wait for all cache lookups to complete
  await Promise.all(cachePromises);

  // If we have tokens that need fetching, get them from Botega
  if (tokensToFetch.length > 0) {
    try {
      const fetchedPrices = await fetchBotegaPrices(tokensToFetch);

      // Cache each token price individually and add to result
      const cacheOperations = Object.entries(fetchedPrices).map(
        ([tokenId, price]) => {
          const cacheKey = `botega:price:${tokenId}`;
          // Add to result
          result[tokenId] = price;
          // Cache individually
          return redis.set(
            cacheKey,
            {
              price,
              timestamp: Date.now(),
            },
            { ex: 300 } // expire in 5 minutes
          );
        }
      );

      // Execute all cache operations
      await Promise.all(cacheOperations);
    } catch (error) {
      // If fetch fails, set null for all uncached tokens
      console.error("Error fetching Botega prices:", error);
      tokensToFetch.forEach((tokenId) => {
        result[tokenId] = null;
      });
    }
  }

  return result;
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
 * @returns Object with update results
 */
export async function updateAllBotegaPrices(): Promise<
  Record<string, number | null>
> {
  if (TRACKED_BOTEGA_TOKENS.length === 0) {
    return {};
  }

  try {
    const prices = await getBotegaPrices(TRACKED_BOTEGA_TOKENS);
    return prices;
  } catch (error) {
    console.error("Failed to update Botega prices:", error);
    return {};
  }
}

/**
 * Update price for a single Botega token
 * @param tokenId Token ID
 * @returns Price of the token or null if fetch failed
 */
export async function updateSingleBotegaPrice(
  tokenId: string
): Promise<number | null> {
  try {
    const prices = await getBotegaPrices([tokenId]);
    return prices[tokenId] || null;
  } catch (error) {
    console.error(`Failed to update Botega price for ${tokenId}:`, error);
    return null;
  }
}
interface DryRunTag {
  name: string;
  value: string | Record<string, unknown>;
}

// These interfaces are defined by @permaweb/aoconnect, no need to redefine them here
