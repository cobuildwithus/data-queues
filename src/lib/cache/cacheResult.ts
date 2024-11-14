import { RedisClientType } from 'redis';

/**
 * Generic cache function that checks and stores results in Redis.
 * Caching is disabled in development environment.
 */
export async function cacheResult<T>(
  redisClient: RedisClientType,
  key: string,
  prefix: string,
  fetchFn: () => Promise<T>,
  shouldCache: boolean = process.env.NODE_ENV !== 'development'
): Promise<T> {
  // Check cache first if caching is enabled
  if (shouldCache) {
    const cached = await redisClient.get(`${prefix}${key}`);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  }

  // Fetch fresh result
  const result = await fetchFn();

  // Cache result if caching is enabled and result exists
  if (shouldCache && result !== null && result !== undefined) {
    await redisClient.set(`${prefix}${key}`, JSON.stringify(result));
  }

  return result;
}

/**
 * Helper function to get a cached result from Redis.
 * Returns null if not found or if caching is disabled.
 */
export async function getCachedResult<T>(
  redisClient: RedisClientType,
  key: string,
  prefix: string,
  shouldCache: boolean = process.env.NODE_ENV !== 'development'
): Promise<T | null> {
  if (!shouldCache) {
    return null;
  }

  const cached = await redisClient.get(`${prefix}${key}`);
  if (!cached) {
    return null;
  }

  return JSON.parse(cached) as T;
}
