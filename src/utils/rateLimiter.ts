// force rebuild
import { Redis } from "@upstash/redis";

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    redisClient = null;
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

export async function rateLimit(userId: string) {
  const redis = getRedis();
  if (!redis) return false;

  const key = `rate:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60); // reset window every 60s
  }

  return current > 10; // true if over limit
}
