import { redis } from "./redis";

interface CoinGeckoPriceResult {
  [coinId: string]: {
    [currency: string]: number;
  };
}

export interface CoinGeckoMarketChartResult {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
  status?: {
    error_code: number;
    error_message: string;
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
    { ex: 86400 } // 24 hours
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

interface CachedMarketChartData {
  prices: [number, number][];
  timestamp: string;
}

export const CHART_PERIODS: Record<string, string> = {
  "1": "1 day",
  "7": "1 week",
  "30": "1 month",
  "90": "3 months",
  "180": "6 months",
  "365": "1 year",
};

export const VALID_TIME_PERIODS = Object.keys(CHART_PERIODS);

/**
 * Fetches Arweave market chart data with caching
 * @param currency Currency to get prices in (e.g., "usd")
 * @param days Time period: "1", "7", "30", "90", "180", or "365"
 * @returns Market chart data from CoinGecko
 */
export interface MarketChartResponse extends CoinGeckoMarketChartResult {
  fresh?: boolean;
  cachedAt?: string;
  cacheAge?: number;
}

export async function getMarketChart(
  currency: string = "usd",
  days: string | number = "7"
): Promise<MarketChartResponse> {
  const daysStr = String(days);
  if (!VALID_TIME_PERIODS.includes(daysStr)) {
    throw new Error(
      `Invalid time period. Must be one of: ${VALID_TIME_PERIODS.join(", ")}`
    );
  }

  // cache key
  const cacheKey = `chart:arweave:${currency}:${daysStr}`;

  try {
    const cachedData = await redis.get<CachedMarketChartData>(cacheKey);

    if (cachedData) {
      const cacheTimestamp = new Date(cachedData.timestamp);
      const cacheAge = Math.floor(
        (Date.now() - cacheTimestamp.getTime()) / 1000
      );
      const isFresh = cacheAge < 5 * 60; // less than 5 minutes old

      if (isFresh) {
        return {
          prices: cachedData.prices,
          market_caps: [],
          total_volumes: [],
          fresh: true,
          cachedAt: cachedData.timestamp,
          cacheAge,
        };
      }
    }

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/arweave/market_chart?vs_currency=${currency}&days=${daysStr}`
    );

    if (!response.ok) {
      console.error(`CoinGecko API error: ${response}`);
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoMarketChartResult;

    if ("status" in data && data.status?.error_code) {
      throw new Error("CoinGecko API error");
    }

    // cache the data
    await redis.set(
      cacheKey,
      {
        prices: data.prices,
        timestamp: new Date().toISOString(),
      },
      { ex: 86400 } // 24 hours
    );

    return {
      ...data,
      fresh: true,
      cachedAt: new Date().toISOString(),
      cacheAge: 0,
    };
  } catch (error) {
    console.error(`Failed to fetch Arweave chart data:`, error);

    // fallback to cached data if API fails
    const cachedData = await redis.get<CachedMarketChartData>(cacheKey);
    if (cachedData) {
      const cacheTimestamp = new Date(cachedData.timestamp);
      const cacheAge = Math.floor(
        (Date.now() - cacheTimestamp.getTime()) / 1000
      );

      return {
        prices: cachedData.prices,
        market_caps: [],
        total_volumes: [],
        fresh: false,
        cachedAt: cachedData.timestamp,
        cacheAge,
      };
    }

    throw error;
  }
}
