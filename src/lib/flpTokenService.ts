import { aoInstance } from "@/lib/aoconnect";
import { redis } from "./redis";
import { retryWithDelay } from "@/utils/retry.utils";

interface RawFlpToken {
  flp_token_name: string;
  flp_token_ticker: string;
  flp_token_denomination: number;
  flp_token_logo: string;
  flp_token_process: string;
  flp_id: string;
}

interface FlpToken {
  name: string;
  ticker: string;
  denomination: number;
  logo: string;
  id: string;
  flpId: string;
  autoClaim: boolean;
}

type DelegationRecord = Record<string, number>;

interface CachedFlpTokenData {
  flpTokens: FlpToken[];
  timestamp: number;
}

/**
 * Test token FLP IDs that should be filtered out from the results.
 * These are test tokens that should not appear in the results.
 */
const TEST_TOKEN_FLP_IDS = new Set([
  "T3M4QSF7VGa0le7KtxBDHOaIcjnZeC-SQ7nh3ABuufs",
  "So2HpldZaaVFbeH8mUGGzQBVdEzAx5HvMyMaZ47az_M",
  "4mowY7A-b6WJyVR-Tde2m3Zcl_JVxil21c15PXiHhfA",
  "-ntvNGm4onpKXS8SZ6-5sFnmjRHfMNAwS_JuR-pO504",
  "WRkDu1hOeNksAlli1R4LUUh674Q79DjSOSegdIiI68U",
  "c0-R2wvW1yRnRjQdUqetgD9tDJSCGpeJjz1HthfXwQ8",
  "wsT2snFHYQ7AX7OxnrFViyu4v5il6sIb9EYxTnBnMQc",
  "FyQ9uMx1XevItG1kE65BMvbbqcvdOGJrC_nb-PPIawk",
  "xswbZRtkjQQ8D1h6tx503iLaAxxPLWP10J2TvgbRZXk",
  "NQy9H6oAE-m55BheXbGu70nEWiiGMsL8lM9YsNJ8gD4",
  "gkcnuAZeFeqPvFvNABFKGRKGE_AsmA0T3I1_jOFF0MU",
  "Gmf5PyNLd1R4uENH2ITg03KxKMi25g1ZJl1F6AplQRc",
]);

/**
 * Manual claimable token FLP IDs that require manual intervention for claiming rewards.
 * These tokens do not support auto-claim functionality and must be claimed manually by users.
 */
const MANUAL_CLAIMABLE_FLP_IDS = new Set([
  "NXZjrPKh-fQx8BUCG_OXBUtB4Ix8Xf0gbUtREFoWQ2Q", // ACTION Token
  "rW7h9J9jE2Xp36y4SKn2HgZaOuzRmbMfBRPwrFFifHE", // AR.IO Token
  "3eZ6_ry6FD9CB58ImCQs6Qx_rJdDUGhz-D2W1AqzHD8", // PIXL Token
  "Wc8Rg-owsWSvrmb5XAlmSs3_4UtHo9i5ui2o9UCFuTk", // Protocol Land
]);

const CACHE_KEY = "flp-tokens";
const CACHE_EXPIRY = 86400; // 24 hours in seconds

// Process IDs for AO interactions
const WNDR_PROCESS_ID = "7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4";
const FLP_AO_DELEGATION_TRACKER_PROCESS_ID =
  "NRP0xtzeV9MHgwLmgD254erUB7mUjMBhBkYkNYkbNEo";
const FLP_REGISTRY_PROCESS_ID = "It-_AKlEfARBmJdbJew1nG9_hIaZt0t20wQc28mFGBE";

/**
 * Get the total delegation of AO by project.
 * This is used to sort the flp tokens by the total delegation of AO.
 */
async function getTotalAODelegationByProject(): Promise<DelegationRecord> {
  try {
    const result = await retryWithDelay(() =>
      aoInstance.dryrun({
        process: FLP_AO_DELEGATION_TRACKER_PROCESS_ID,
        tags: [{ name: "Action", value: "Get-Total-Delegated-AO-By-Project" }],
      })
    );

    const data = result?.Messages[0]?.Data ?? "{}";
    const totalDelegatedAOByProject = JSON.parse(data);
    return totalDelegatedAOByProject?.combined ?? {};
  } catch {
    return {};
  }
}

/**
 * Fetches FLP tokens from AO registry, filters test tokens, and sorts by delegation amount.
 */
async function getFlpTokensFromAo(): Promise<FlpToken[]> {
  const result = await retryWithDelay(() =>
    aoInstance.dryrun({
      process: FLP_REGISTRY_PROCESS_ID,
      tags: [{ name: "Action", value: "Get-FLPs" }],
    })
  );

  const data = result?.Messages[0]?.Data ?? "{}";
  const rawFlpTokens: RawFlpToken[] = JSON.parse(data);

  const totalAODelegationByProject = await getTotalAODelegationByProject();

  const flpTokens = rawFlpTokens
    .map((token: RawFlpToken): FlpToken => {
      return {
        id: token.flp_token_process,
        flpId: token.flp_id,
        name: token.flp_token_name,
        ticker: token.flp_token_ticker,
        denomination: +token.flp_token_denomination,
        logo: token.flp_token_logo,
        autoClaim: !MANUAL_CLAIMABLE_FLP_IDS.has(token.flp_id),
      };
    })
    .filter(
      (token: FlpToken): boolean =>
        token.id !== undefined &&
        !!token.name &&
        !!token.ticker &&
        !isNaN(token.denomination) &&
        !TEST_TOKEN_FLP_IDS.has(token.flpId)
    )
    .sort((a: FlpToken, b: FlpToken): number => {
      if (a.id === WNDR_PROCESS_ID) return -1;
      if (b.id === WNDR_PROCESS_ID) return 1;
      return (
        (totalAODelegationByProject[b.flpId] ?? 0) -
        (totalAODelegationByProject[a.flpId] ?? 0)
      );
    });

  return flpTokens;
}

/**
 * Gets FLP tokens from cache or fetches from AO if not cached.
 */
export async function getFlpTokens() {
  try {
    const cachedFlpTokensData = await redis.get<CachedFlpTokenData>(CACHE_KEY);

    if (cachedFlpTokensData) {
      const { flpTokens, timestamp } = cachedFlpTokensData;
      const now = Date.now();
      const cacheAge = Math.floor((now - timestamp) / 1000);

      return {
        flpTokens,
        fresh: true,
        cachedAt: new Date(timestamp).toISOString(),
        cacheAge,
      };
    }
  } catch (error) {
    console.error(`Error reading cache:`, error);
  }

  // If not in cache or error, fetch from AO
  try {
    const flpTokens = await getFlpTokensFromAo();
    await redis.set(
      CACHE_KEY,
      { flpTokens, timestamp: Date.now() },
      { ex: CACHE_EXPIRY }
    );

    return {
      flpTokens,
      fresh: true,
      cachedAt: new Date().toISOString(),
      cacheAge: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch flp tokens: ${errorMessage}`);
  }
}
