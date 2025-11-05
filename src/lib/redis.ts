import Redis from "ioredis";

const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis || new Redis(process.env.REDIS_URL as string);

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

export const redisHelper = {
  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  },

  async set(
    key: string,
    value: unknown,
    options?: { ex?: number }
  ): Promise<void> {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    if (options?.ex) {
      await redis.setex(key, options.ex, stringValue);
    } else {
      await redis.set(key, stringValue);
    }
  },
};
