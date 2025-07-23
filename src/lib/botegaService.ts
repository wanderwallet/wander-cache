import "./polyfill";
import { fetchPriceFromCoingeckoApi } from "./priceService";
import { redis } from "./redis";

const AO_PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const BOTEGA_API_KEY = process.env.BOTEGA_API_KEY as string;

interface CachedBotegaPriceData {
  price: number | null;
  timestamp: number;
}

interface PriceSource {
  (tokenIds: string[]): Promise<[boolean, Record<string, number | null>]>;
}

type PermaswapApiResponse = Array<{
  address: string;
  process: string;
  price: number;
}>;

interface BotegaApiResponse {
  Prices: Record<string, { price?: number }>;
}

export interface BotegaPriceResponse {
  prices: Record<string, number | null>;
  cacheInfo: Record<string, { cachedAt: number }>;
}

export const TRACKED_BOTEGA_TOKENS = [
  "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10",
  AO_PROCESS_ID,
  "NG-0lVX882MG5nhARrSzyprEK6ejonHpdUmaaMPsHE8",
];

/**
 * Get Botega prices with caching
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices with cache metadata
 */
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
      cacheInfo[tokenId] = { cachedAt: cachedPrice.timestamp };

      if (!isFresh) {
        tokensToFetch.push(tokenId);
      }
    } else {
      tokensToFetch.push(tokenId);
    }
  });

  // Wait for all cache lookups to complete
  await Promise.allSettled(cachePromises);

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
          cacheInfo[tokenId] = { cachedAt: now };

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
          cacheInfo[tokenId] = { cachedAt: Date.now() };
        }
      });
    }
  }

  return { prices: result, cacheInfo };
}

/**
 * Fetch Token prices from the Botega API
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchTokenPricesFromBotegaApi(
  tokenIds: string[]
): Promise<[boolean, Record<string, number | null>]> {
  try {
    const response = await fetch(
      "https://kzmzniagsfcfnhgsjkpv.supabase.co/functions/v1/hopper",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: BOTEGA_API_KEY,
          authorization: `Bearer ${BOTEGA_API_KEY}`,
        },
        body: `{"batch": ${JSON.stringify(tokenIds)},"priceOnly":true}`,
      }
    );

    if (!response.ok) {
      throw new Error(`Botega API error: ${response.status}`);
    }

    const data = (await response.json()) as BotegaApiResponse;
    const prices: Record<string, number | null> = {};

    Object.entries(data.Prices).forEach(([tokenId, tokenData]) => {
      prices[tokenId] = tokenData?.price || null;
    });

    return [true, prices];
  } catch (error) {
    console.error("Error fetching Botega prices from Botega API:", error);
    return [false, Object.fromEntries(tokenIds.map((id) => [id, null]))];
  }
}

/**
 * Fetch Token prices from the Permaswap API
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchTokenPricesFromPermaswapApi(
  tokenIds: string[]
): Promise<[boolean, Record<string, number | null>]> {
  try {
    const response = await fetch(
      "https://api-ffpscan.permaswap.network/tokenList",
      {
        method: "GET",
        headers: { accept: "application/json" },
      }
    );

    if (!response.ok) {
      throw new Error(`Permaswap API error: ${response.status}`);
    }

    const tokens = (await response.json()) as PermaswapApiResponse;

    const prices: Record<string, number | null> = {};
    const tokenSet = new Set(tokenIds);

    tokens.forEach((token) => {
      if (tokenSet.has(token.process)) {
        prices[token.process] = +token?.price || null;
      }
    });

    return [true, prices];
  } catch (error) {
    console.error("Error fetching Botega prices from Permaswap API:", error);
    return [false, Object.fromEntries(tokenIds.map((id) => [id, null]))];
  }
}

/**
 * Fetch Token prices from multiple sources with fallback
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchBotegaPrices(
  tokenIds: string[]
): Promise<Record<string, number | null>> {
  const priceSources: PriceSource[] = [
    fetchTokenPricesFromBotegaApi,
    fetchTokenPricesFromPermaswapApi,
  ];

  for (const fetchPrices of priceSources) {
    try {
      const [success, prices] = await fetchPrices(tokenIds);
      if (success) {
        if (tokenIds.includes(AO_PROCESS_ID) && !prices[AO_PROCESS_ID]) {
          const aoPrice = await fetchAOPrice();
          if (aoPrice) prices[AO_PROCESS_ID] = aoPrice;
        }
        return prices;
      }
    } catch {}
  }

  // All sources failed - return null prices
  return Object.fromEntries(tokenIds.map((id) => [id, null]));
}

/**
 * Fetch AO price from multiple sources
 * @returns Price value
 */
async function fetchAOPrice(): Promise<number | null> {
  const priceSources = [
    fetchAOPriceFromCoingeckoApi,
    fetchAOPriceFromCoinmarketcapApi,
  ];

  for (const fetchPrice of priceSources) {
    try {
      const price = await fetchPrice();
      if (price) return price;
    } catch {}
  }

  return null;
}

/**
 * Fetch AO price from the Coingecko API
 * @returns Price value
 */
async function fetchAOPriceFromCoingeckoApi(): Promise<number | null> {
  try {
    return await fetchPriceFromCoingeckoApi("AO-COMPUTER", "usd");
  } catch (error) {
    console.error("Error fetching AO price from Coingecko API:", error);
    return null;
  }
}

/**
 * Fetch AO price from the Coinmarketcap API
 * @returns Price value
 */
async function fetchAOPriceFromCoinmarketcapApi(): Promise<number | null> {
  try {
    const SYMBOL = "AO";
    const response = await fetch(
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${SYMBOL}`,
      {
        method: "GET",
        headers: {
          "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY as string,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinMarketCap API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[SYMBOL].quote.USD.price;
  } catch (error) {
    console.error("Error fetching AO price from Coinmarketcap API:", error);
    return null;
  }
}

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
