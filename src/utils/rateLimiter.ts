// force rebuild
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function rateLimit(userId: string) {
  const key = `rate:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60); // reset window every 60s
  }

  return current > 10; // true if over limit
}
