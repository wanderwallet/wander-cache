import { redis } from "./redis";

interface CoinGeckoPriceResult {
  [coinId: string]: {
    [currency: string]: number;
  };
}

// Define the cached price data structure
interface CachedPriceData {
  price: number;
  timestamp: number;
}

// List of cryptocurrencies to automatically refresh
export const TRACKED_CRYPTOS = [{ symbol: "arweave", currency: "usd" }];

/**
 * Get cryptocurrency price with caching
 * @param symbol Cryptocurrency symbol (default: 'arweave')
 * @param currency Currency to convert to (default: 'usd')
 * @returns Price value
 */
export async function getPrice(
  symbol: string = "arweave",
  currency: string = "usd"
): Promise<number> {
  const cacheKey = `price:${symbol.toLowerCase()}:${currency.toLowerCase()}`;

  // Cache first
  const cachedPrice = await redis.get<CachedPriceData>(cacheKey);

  if (cachedPrice) {
    try {
      const { price, timestamp } = cachedPrice as CachedPriceData;

      // 5 minute stale cache
      const now = Date.now();
      if (now - timestamp < 5 * 60 * 1000) {
        return price;
      }
    } catch (error) {
      console.error("Error parsing cache:", error);
      console.error("Raw cache value:", cachedPrice);
    }
  }

  // If not in cache or stale, fetch from CoinGecko
  try {
    const price = await fetchPriceFromApi(symbol, currency);
    return price;
  } catch (error: unknown) {
    // If fetch fails but we have a stale cache, return that instead of failing
    if (cachedPrice) {
      try {
        return cachedPrice.price;
      } catch (error) {
        console.error("Error using fallback cache:", error);
        throw error;
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to fetch price for ${symbol}: ${errorMessage}`);
  }
}

/**
 * Fetch price from CoinGecko API and update cache
 * @param symbol Cryptocurrency symbol
 * @param currency Currency to convert to
 * @returns Price value
 */
export async function fetchPriceFromApi(
  symbol: string,
  currency: string
): Promise<number> {
  const cacheKey = `price:${symbol.toLowerCase()}:${currency.toLowerCase()}`;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=${currency.toLowerCase()}`
  );

  if (!response.ok) {
    throw new Error(
      `CoinGecko API error: ${response.status} ${response.statusText}`
    );
  }

  const data: CoinGeckoPriceResult = await response.json();

  // Verify the data structure is as expected
  if (
    !data[symbol.toLowerCase()] ||
    data[symbol.toLowerCase()][currency.toLowerCase()] === undefined
  ) {
    throw new Error(
      `Invalid data format from CoinGecko API for ${symbol}/${currency}`
    );
  }

  const price = data[symbol.toLowerCase()][currency.toLowerCase()];

  // Cache the result with timestamp
  await redis.set(
    cacheKey,
    JSON.stringify({
      price,
      timestamp: Date.now(),
    }),
    { ex: 300 } // expire in 5 minutes
  );

  return price;
}

/**
 * Update prices for all tracked cryptocurrencies
 * @returns Object with update results
 */
export async function updateAllPrices(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const errors: string[] = [];

  // Use Promise.allSettled to attempt all updates even if some fail
  const updatePromises = TRACKED_CRYPTOS.map(async ({ symbol, currency }) => {
    try {
      const price = await fetchPriceFromApi(symbol, currency);
      results[`${symbol}:${currency}`] = price;
      return price;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push(`${symbol}:${currency} - ${errorMessage}`);
    }
  });

  await Promise.allSettled(updatePromises);

  // If any errors occurred, log them but don't fail
  if (errors.length > 0) {
    console.error("Price update errors:", errors);
  }

  return results;
}
