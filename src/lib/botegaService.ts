import "./polyfill";
import { fetchPriceFromCoingeckoApi } from "./priceService";
import { redis } from "./redis";
import { dryrun } from "@permaweb/aoconnect";

const AO_PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const DEXI_API_KEY = process.env.DEXI_API_KEY as string;

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
 * Fetch Token prices from the Botega Process
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchTokenPricesFromBotegaProcess(
  tokenIds: string[]
): Promise<[boolean, Record<string, number | null>]> {
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
    if (!pricesTag?.value) {
      return [false, Object.fromEntries(tokenIds.map((id) => [id, null]))];
    }

    const prices: Record<string, number | null> = {};

    const parsedValue =
      typeof pricesTag.value === "string"
        ? JSON.parse(pricesTag.value)
        : pricesTag.value;

    Object.entries(parsedValue).forEach((entry) => {
      const tokenId = entry[0];
      const data = entry[1] as { price?: number };
      prices[tokenId] = data.price || null;
    });

    return [true, prices];
  } catch (error) {
    console.error("Error fetching Botega prices:", error);
    return [false, Object.fromEntries(tokenIds.map((id) => [id, null]))];
  }
}

/**
 * Fetch Token prices from the Dexi API
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchTokenPricesFromDexiApi(
  tokenIds: string[]
): Promise<[boolean, Record<string, number | null>]> {
  try {
    const response = await fetch(
      "https://kzmzniagsfcfnhgsjkpv.supabase.co/functions/v1/hopper",
      {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.6",
          apikey: DEXI_API_KEY,
          authorization: `Bearer ${DEXI_API_KEY}`,
          "content-type": "application/json",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
          "sec-gpc": "1",
          "x-client-info": "supabase-js-web/2.50.0",
          Referer: "https://dexi.defi.ao/",
        },
        body: `{"batch": ${JSON.stringify(tokenIds)},"priceOnly":true}`,
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch from Dexi API");
    }

    const data = await response.json();
    const prices: Record<string, number | null> = {};

    Object.entries(data.Prices).forEach((entry) => {
      const tokenId = entry[0];
      const data = entry[1] as { price?: number };
      prices[tokenId] = data.price || null;
    });

    return [true, prices];
  } catch (error) {
    console.error("Error fetching Botega prices from Dexi API:", error);
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
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          "sec-gpc": "1",
          Referer: "https://www.permaswap.network/",
        },
        body: null,
        method: "GET",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch from Permaswap API");
    }

    const tokens = (await response.json()) as {
      address: string;
      process: string;
      price: number;
    }[];

    const prices: Record<string, number | null> = {};
    tokens.forEach((token) => {
      if (tokenIds.includes(token.address)) {
        prices[token.process] = token.price || null;
      }
    });

    return [true, prices];
  } catch (error) {
    console.error("Error fetching Botega prices from Permaswap API:", error);
    return [false, Object.fromEntries(tokenIds.map((id) => [id, null]))];
  }
}

/**
 * Fetch Token prices from the API
 * @param tokenIds Array of token IDs to get prices for
 * @returns Record of token IDs to prices
 */
async function fetchBotegaPrices(
  tokenIds: string[]
): Promise<Record<string, number | null>> {
  try {
    const priceSources = [
      fetchTokenPricesFromDexiApi,
      fetchTokenPricesFromPermaswapApi,
      fetchTokenPricesFromBotegaProcess,
    ];

    for (const fetchPrices of priceSources) {
      const [success, prices] = await fetchPrices(tokenIds);
      if (success) {
        if (tokenIds.includes(AO_PROCESS_ID) && !prices[AO_PROCESS_ID]) {
          const aoPrice = await fetchAOPrice();
          prices[AO_PROCESS_ID] = aoPrice || null;
        }
        return prices;
      }
    }

    // Return null prices if all sources fail
    return Object.fromEntries(tokenIds.map((id) => [id, null]));
  } catch (error) {
    console.error("Error fetching Botega prices:", error);
    return Object.fromEntries(tokenIds.map((id) => [id, null]));
  }
}

/**
 * Fetch AO price from the API
 * @returns Price value
 */
async function fetchAOPrice(): Promise<number | null> {
  try {
    const priceSources = [
      fetchAOPriceFromCoingeckoApi,
      fetchAOPriceFromCoinmarketcapApi,
    ];

    for (const fetchPrice of priceSources) {
      const price = await fetchPrice();
      if (price) return price;
    }

    return null;
  } catch (error) {
    console.error("Error fetching AO price:", error);
    return null;
  }
}

/**
 * Fetch AO price from the Coingecko API
 * @returns Price value
 */
async function fetchAOPriceFromCoingeckoApi(): Promise<number | null> {
  try {
    const price = await fetchPriceFromCoingeckoApi("AO-COMPUTER", "usd");
    return price;
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
      throw new Error("Failed to fetch from Coinmarketcap API");
    }

    const data = await response.json();
    const price = data.data[SYMBOL].quote.USD.price;
    return price;
  } catch (error) {
    console.error("Error fetching AO price from Coinmarketcap API:", error);
    return null;
  }
}

export const TRACKED_BOTEGA_TOKENS = [
  "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10",
  AO_PROCESS_ID,
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
