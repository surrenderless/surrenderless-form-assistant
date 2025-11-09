import Redis from "ioredis";

const redis = new Redis(process.env.UPSTASH_REDIS_URL!);

export async function rateLimit(userId: string) {
  const key = `rate:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60); // reset window every 60s
  }

  return current > 10; // true if over limit
}
