import { dataosAoInstance } from "@/lib/aoconnect";
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
  // LLAMA REBORN
  "ybJns4GXaCfXifPoJAXTGjSaeU24DL18OpaKTQ89xe0",
  "MH2WTdN3de3XKYyQ_Yufx-y-YkqV_57yPNKP4n1_3t8",
  "GDiWVCFSaOngnyp17xM5VX-jqofYKBN6c1vNBnz02hw",
  "nBqlzp2lSU_ciociG2OrTxjDfzA_nfhttv4qqyylMn4",
  "_L_GMvgax750A8oORtNPetcmq5fog3K6WtvY4PFpipo",
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

const defaultFlpTokens = [
  {
    id: "7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4",
    flpId: "11T2aA8M-ZcoEnDqG37Kf2dzEGY2r4_CyYeiN_1VTvU",
    name: "Wander",
    ticker: "WNDR",
    denomination: 18,
    logo: "xUO2tQglSYsW89aLYN8ErGivZqezoDaEn95JniaCBZk",
    autoClaim: true,
  },
  {
    id: "mqBYxpDsolZmJyBdTK8TJp_ftOuIUXVYcSQ8MYZdJg0",
    flpId: "jHZBsy0SalZ6I5BmYKRUt0AtLsn-FCFhqf_n6AgwGlc",
    name: "APUS Network",
    ticker: "APUS",
    denomination: 12,
    logo: "sixqgAh5MEevkhwH4JuCYwmumaYMTOBi3N5_N1GQ6Uc",
    autoClaim: true,
  },
  {
    id: "gx_jKk-hy8-sB4Wv5WEuvTTVyIRWW3We7rRHthcohBQ",
    flpId: "Qz3n2P-EiWNoWsvk7gKLtrV9ChvSXQ5HJPgPklWEgQ0",
    name: "Load Network",
    ticker: "LOAD",
    denomination: 18,
    logo: "d9WT5suSheKe5ZSCRJuRb7CJMrI0oun5XKDwNMtsTY8",
    autoClaim: true,
  },
  {
    id: "Nx-_Ichdp-9uO_ZKg2DLWPiRlg-DWrSa2uGvINxOjaE",
    flpId: "UcBPqkaVI7W4I_YMznrt2JUoyc_7TScCdZWOOSBvMSU",
    name: "Botega Token",
    ticker: "BOTG",
    denomination: 18,
    logo: "MNwa55CLIY_LXlFaj612UdKwJl04G5bkO-HUVPwF9lI",
    autoClaim: true,
  },
  {
    id: "OiNYKJ16jP7uj7z0DJO7JZr9ClfioGacpItXTn9fKn8",
    flpId: "NXZjrPKh-fQx8BUCG_OXBUtB4Ix8Xf0gbUtREFoWQ2Q",
    name: "Action",
    ticker: "ACTION",
    denomination: 18,
    logo: "bwup_2BRueewi8ni4R04d8qVtzsAORoaQ8_k2uAIBRk",
    autoClaim: false,
  },
  {
    id: "GegJSRSQptBJEF5lcr4XEqWLYFUnNr3_zKQ-P_DnDQs",
    flpId: "t7_efxAUDftIEl9QfBi0KYSz8uHpMS81xfD3eqd89rQ",
    name: "AO Strategy",
    ticker: "AOS",
    denomination: 18,
    logo: "",
    autoClaim: true,
  },
  {
    id: "K59Wi9uKXBQfTn3zw7L_t-lwHAoq3Fx-V9sCyOY3dFE",
    flpId: "oIuISObCStjTFMnV3CrrERRb9KTDGN4507-ARysYzLE",
    name: "Space Money",
    ticker: "SMONEY",
    denomination: 18,
    logo: "Jr8gjPMCE1aTgN73tRfseL1ZD-OFbGHoA__MWl0QxI4",
    autoClaim: true,
  },
  {
    id: "n2MhPK0O3yEvY2zW73sqcmWqDktJxAifJDrri4qireI",
    flpId: "N0L1lUC-35wgyXK31psEHRjySjQMWPs_vHtTas5BJa8",
    name: "LiquidOps",
    ticker: "LQD",
    denomination: 18,
    logo: "iI9VnQdPXlVl967iAdCY4zJYVBfk5jpr_qab-Hzm4qI",
    autoClaim: true,
  },
  {
    id: "Jc2bcfEbwHFQ-qY4jqm8L5hc-SggeVA1zlW6DOICWgo",
    flpId: "Wc8Rg-owsWSvrmb5XAlmSs3_4UtHo9i5ui2o9UCFuTk",
    name: "Protocol Land",
    ticker: "PL",
    denomination: 18,
    logo: "DvtICU2c-wM41VZIcrMutHmo5b6WV1CDXaavOJ4a5YU",
    autoClaim: false,
  },
  {
    id: "s6jcB3ctSbiDNwR-paJgy5iOAhahXahLul8exSLHbGE",
    flpId: "nYHhoSEtelyL3nQ6_CFoOVnZfnz2VHK-nEez962YMm8",
    name: "ArcAO",
    ticker: "GAME",
    denomination: 18,
    logo: "-c4VdpgmfuS4YadtLuxVZzTd2DQ3ipodA6cz8pwjn20",
    autoClaim: true,
  },
  {
    id: "qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE",
    flpId: "rW7h9J9jE2Xp36y4SKn2HgZaOuzRmbMfBRPwrFFifHE",
    name: "AR.IO",
    ticker: "ARIO",
    denomination: 12,
    logo: "Sie_26dvgyok0PZD_-iQAFOhOd5YxDTkczOLoqTTL_A",
    autoClaim: false,
  },
  {
    id: "5IrQh9aoWTLlLTXogXdGd7FcVubFKOaw7NCRGnkyXCM",
    flpId: "oTkFjTiRUKGp-Lk1YduBDTRRc7j1dM0W_bTgp5Aach8",
    name: "Nau",
    ticker: "NAU",
    denomination: 18,
    logo: "foyGUHBqp8gvUnlWmg_HIw9fIXXZC1gRnwtuD5aBA0A",
    autoClaim: true,
  },
  {
    id: "DM3FoZUq_yebASPhgd8pEIRIzDW6muXEhxz5-JwbZwo",
    flpId: "3eZ6_ry6FD9CB58ImCQs6Qx_rJdDUGhz-D2W1AqzHD8",
    name: "PIXL Token",
    ticker: "PIXL",
    denomination: 6,
    logo: "czR2tJmSr7upPpReXu6IuOc2H7RuHRRAhI7DXAUlszU",
    autoClaim: false,
  },
  {
    id: "kfq7JKVeu-Z9qA0y-0YKXbgNqKJzENqVl0KSrPDOBl4",
    flpId: "8TRsYFzbhp97Er5bFJL4Xofa4Txv4fv8S0szEscqopU",
    name: "Vela",
    ticker: "VELA",
    denomination: 18,
    logo: "0BJTlTzM3ag7bkAFEGD9XMpxR3NTDUUZbj7YF9oEeVo",
    autoClaim: true,
  },
  {
    id: "OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU",
    flpId: "X0HxJGSBzney-YLDzAtjt9Pc-c6N_1sf_MlqO0ezoeI",
    name: "Number Always Bigger",
    ticker: "NAB",
    denomination: 8,
    logo: "LQ4crOHN9qO6JsLNs253AaTch6MgAMbM8PKqBxs4hgI",
    autoClaim: true,
  },
  {
    id: "uEqh7GDRNsn4izN95zdwIdUULwnG35it8B7C7EIjZfc",
    flpId: "nyVvVL_-lnX82SJ5tuwPXBbxPhJfGoXiudqheL1whb0",
    name: "IONODEONLINE",
    ticker: "IONODE",
    denomination: 18,
    logo: "Nz7u8ByGHsYaZVcRLqpDqcqTCZkvQ6xPrGokYKycfE8",
    autoClaim: true,
  },
  {
    id: "oX5gh0j-DNHUvolnujWqKRcrrna1e-dsyy6CAjqGtBc",
    flpId: "AiaC4WHT_onQMhacqcU-BHwRpoaBU-QugyfjgjW8Z7E",
    name: "SecServe",
    ticker: "SCS",
    denomination: 18,
    logo: "Rq-T5_0U0L1c50Yq5gTu1LMczjQZHvkW4I30t8f4QN4",
    autoClaim: true,
  },
  {
    id: "Zb5PFBVRiTo0Q7h7edGGsrXpDovAyAXAipEgYeB2tIc",
    flpId: "Er1evvPMEL3I1VpZ2sWQM4CTaRWiyo8CoBFsU4qS-Lg",
    name: "FairTokenX",
    ticker: "FTX",
    denomination: 18,
    logo: "KyTHeOx744RcGSsIFkpeCY7AQjekEkiwUhX0WVmsfns",
    autoClaim: true,
  },
];

const CACHE_KEY = "flp-tokens";

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
      dataosAoInstance.dryrun({
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
    dataosAoInstance.dryrun({
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

  return {
    flpTokens: defaultFlpTokens,
    fresh: true,
    cachedAt: new Date().toISOString(),
    cacheAge: 0,
  };
}

/**
 * Updates FLP tokens in cache.
 */
export async function updateFlpTokens() {
  try {
    const flpTokens = await getFlpTokensFromAo();
    await redis.set(CACHE_KEY, { flpTokens, timestamp: Date.now() });

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
