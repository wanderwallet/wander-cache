import Redis from "ioredis";

let redisClient: Redis | null | undefined;

const getRedis = (): Redis | null => {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) return (redisClient = null);

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    enableOfflineQueue: false,
  });

  redisClient.on("error", (err) => console.error("[Redis]", err.message));

  return redisClient;
};

export const redisHelper = {
  async get<T>(key: string): Promise<T | null> {
    const client = getRedis();
    if (!client) return null;

    try {
      const value = await client.get(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch {
      return null;
    }
  },

  async set(
    key: string,
    value: unknown,
    options?: { ex?: number }
  ): Promise<void> {
    const client = getRedis();
    if (!client) return;

    try {
      const str = JSON.stringify(value);
      await (options?.ex
        ? client.setex(key, options.ex, str)
        : client.set(key, str));
    } catch {}
  },
};

export const redis = getRedis();
