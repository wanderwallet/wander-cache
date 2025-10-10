import { retryWithDelay } from "@/utils/retry.utils";
import { customAoInstance, ourAoInstance } from "./aoconnect";
import { redis } from "./redis";
import { isArweaveAddress } from "@/utils/address.utils";

type TierWallet = {
  balance: string;
  rank: number | "";
  tier: number;
  progress: number;
  snapshotTimestamp: number;
  totalHolders: number;
};

type WalletsTierInfo = Record<string, TierWallet>;

type CachedWalletsTierInfo = {
  walletsTierInfo: WalletsTierInfo;
  snapshotTimestamp: number;
  totalWallets: number;
};

type WalletsTierInfoFromAo = {
  wallets: Array<{ address: string; balance: string; savings: number }>;
  snapshotTimestamp: number;
};

export const TierTypes = {
  PRIME: 1,
  EDGE: 2,
  RESERVE: 3,
  SELECT: 4,
  CORE: 5,
} as const;

const TierNames = {
  1: "Prime",
  2: "Edge",
  3: "Reserve",
  4: "Select",
  5: "Core",
} as const;

const Tiers = [
  // Prime tier (Top 2%)
  {
    name: TierNames[TierTypes.PRIME],
    thresholdPercent: 2, // Top 2% of wallets
    progressMin: 98, // Progress range: 98-100%
    progressMax: 100,
  },
  // Edge tier (Top 2.01% to 20%)
  {
    name: TierNames[TierTypes.EDGE],
    thresholdPercent: 20, // Top 20% of wallets
    progressMin: 80, // Progress range: 80-98%
    progressMax: 98,
  },
  // Reserve tier (Top 20.01% to 50%)
  {
    name: TierNames[TierTypes.RESERVE],
    thresholdPercent: 50, // Top 50% of wallets
    progressMin: 50, // Progress range: 50-80%
    progressMax: 80,
  },
  // Select tier (Top 50.01% to 80%)
  {
    name: TierNames[TierTypes.SELECT],
    thresholdPercent: 80, // Top 80% of wallets
    progressMin: 20, // Progress range: 20-50%
    progressMax: 50,
  },
  // Core tier (Below 80.01%)
  {
    name: TierNames[TierTypes.CORE],
    thresholdPercent: 100, // Everyone (bottom 20%)
    progressMin: 0, // Progress range: 0-20%
    progressMax: 20,
  },
];

// TODO: Update to actual prod process ID
const TIER_PROCESS_ID = "QC6z9NZYtVYn0Elx40iUmeIYvzKvuqk-OmfoleUxpSQ";

const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds

function getTierThresholds(totalWallets: number) {
  const tierThresholds = [];

  if (totalWallets > 0) {
    for (let i = 0; i < Tiers.length; i++) {
      const tier = Tiers[i];
      const tierIndex = i + 1; // Convert to 1-based index for tier comparison
      const tierThreshold = {
        maxRank: Math.ceil((tier.thresholdPercent * totalWallets) / 100),
        minRank:
          tierIndex == TierTypes.PRIME
            ? 1
            : tierIndex > TierTypes.PRIME
            ? Math.ceil((Tiers[i - 1].thresholdPercent * totalWallets) / 100) +
              1
            : 1,
      };
      tierThresholds.push(tierThreshold);
    }
  }

  return tierThresholds;
}

/**
 * Calculate progress percent within tier range
 * @param walletRank The rank of the wallet
 * @param totalWallets Total number of wallets
 * @returns Progress percentage within tier range
 */
function calculateTierProgressPercent(
  walletRank: number,
  totalWallets: number
): number {
  if (walletRank <= 0 || totalWallets <= 0) return 0;
  return (
    Math.floor(
      ((totalWallets - walletRank + 1) / totalWallets) * 100 * Math.pow(10, 6)
    ) / Math.pow(10, 6)
  );
}

function getWalletTier(walletRank: number, totalWallets: number): number {
  if (walletRank === 0) return TierTypes.CORE;

  const tierThresholds = getTierThresholds(totalWallets);

  for (let i = 0; i < Tiers.length; i++) {
    if (walletRank <= tierThresholds[i].maxRank) {
      return i + 1; // Return 1-based tier index
    }
  }

  return TierTypes.CORE;
}

async function getWalletsTierInfoFromAo() {
  try {
    const response = await fetch(
      `http://forward.computer/${TIER_PROCESS_ID}~process@1.0/now/wallets-tier-info/~json@1.0/serialize/?bundle`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch wallets tier info from HB");
    }
    const data = (await response.json()) as Record<string, TierWallet>;

    let firstWallet: TierWallet | null = null;
    const walletsTierInfo: Record<string, TierWallet> = {};

    for (const [addr, wallet] of Object.entries(data)) {
      if (isArweaveAddress(addr)) {
        if (!firstWallet) {
          firstWallet = wallet;
        }
        walletsTierInfo[addr] = wallet;
      }
    }

    if (!firstWallet) {
      throw new Error("No valid wallet data found");
    }

    const snapshotTimestamp = firstWallet.snapshotTimestamp;
    const totalWallets = firstWallet.totalHolders;
    const actualTotalWallets = Object.keys(walletsTierInfo).length;

    if (!snapshotTimestamp || !totalWallets) {
      throw new Error("Invalid response from HB");
    }

    if (actualTotalWallets !== totalWallets) {
      throw new Error("Total wallets mismatch");
    }

    // Ensure snapshot is not older than 1 day
    const timestampDiff = Date.now() - snapshotTimestamp;
    if (timestampDiff > ONE_DAY_MS) {
      throw new Error("Snapshot data is too old - needs refresh");
    }

    return {
      walletsTierInfo,
      snapshotTimestamp,
      totalWallets,
    };
  } catch (error) {
    console.error("Fallback to dryrun due to HB fetch error: ", error);
    const { wallets, snapshotTimestamp } =
      await retryWithDelay<WalletsTierInfoFromAo>(async (attempt) => {
        const instance = attempt % 2 === 0 ? customAoInstance : ourAoInstance;

        const result = await instance.dryrun({
          process: TIER_PROCESS_ID,
          tags: [{ name: "Action", value: "Get-Wallets" }],
        });

        const data = result?.Messages?.[0]?.Data;
        if (!data) {
          throw new Error("No data returned from AO");
        }

        const parsedData = JSON.parse(data);
        if (!parsedData?.wallets || !parsedData?.snapshotTimestamp) {
          throw new Error("Invalid response from AO");
        }

        return parsedData;
      });

    const totalWallets = wallets.length;

    const walletsTierInfo = wallets.reduce(
      (acc: Record<string, TierWallet>, wallet, index) => {
        const walletRank = index + 1;
        const tier = getWalletTier(walletRank, totalWallets);
        const progress = calculateTierProgressPercent(walletRank, totalWallets);

        const walletData = {
          balance: wallet.balance,
          rank: walletRank,
          tier,
          progress,
          snapshotTimestamp,
          totalHolders: totalWallets,
        };

        acc[wallet.address] = walletData;

        return acc;
      },
      {}
    );

    return { walletsTierInfo, snapshotTimestamp, totalWallets };
  }
}

export async function getWalletsTierInfo(addresses: string[]) {
  const cachedWalletsTierInfo = await redis.get<CachedWalletsTierInfo>(
    "wallets-tier-info"
  );

  let walletsTierInfo: WalletsTierInfo = {};
  let snapshotTimestamp = 0;
  let totalWallets = 0;

  if (!cachedWalletsTierInfo) {
    ({ walletsTierInfo, snapshotTimestamp, totalWallets } =
      await getWalletsTierInfoFromAo());

    const cacheAge = Math.floor(
      (snapshotTimestamp + 24 * 60 * 60 * 1000 - Date.now()) / 1000
    ); // 24 hours from snapshot

    await redis.set(
      "wallets-tier-info",
      { walletsTierInfo, snapshotTimestamp, totalWallets },
      { ex: cacheAge }
    );
  } else {
    ({ walletsTierInfo, snapshotTimestamp, totalWallets } =
      cachedWalletsTierInfo);
  }

  const result = addresses.reduce(
    (acc: Record<string, TierWallet>, address) => {
      if (address in walletsTierInfo) {
        acc[address] = walletsTierInfo[address];
      } else {
        acc[address] = {
          balance: "0",
          rank: "",
          tier: TierTypes.CORE,
          progress: 0,
          snapshotTimestamp,
          totalHolders: totalWallets,
        };
      }
      return acc;
    },
    {}
  );

  return result;
}

export async function getWalletTierInfo(address: string) {
  const walletsTierInfo = await getWalletsTierInfo([address]);
  return walletsTierInfo[address];
}
