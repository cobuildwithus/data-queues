import { RedisClientType } from 'redis';

// const CACHE_ENABLED = process.env.NODE_ENV !== 'development';
const CACHE_ENABLED = false;

/**
 * Generic cache function that stores results in Redis.
 * Caching is disabled in development environment.
 */
export async function cacheResult<T>(
  redisClient: RedisClientType,
  key: string,
  prefix: string,
  fetchFn: () => Promise<T>,
  shouldCache: boolean = CACHE_ENABLED
): Promise<T> {
  // Fetch fresh result
  const result = await fetchFn();

  // Cache result if caching is enabled and result exists
  if (shouldCache && result !== null && result !== undefined) {
    // Handle case where result is just a string
    const valueToCache =
      typeof result === 'string' ? result : JSON.stringify(result);
    await redisClient.set(`${prefix}${key}`, valueToCache);
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
  shouldCache: boolean = CACHE_ENABLED
): Promise<T | null> {
  if (!shouldCache) {
    return null;
  }

  const cached = await redisClient.get(`${prefix}${key}`);
  if (!cached) {
    return null;
  }

  // Handle case where cached value is just a string
  if (
    typeof cached === 'string' &&
    cached.charAt(0) !== '{' &&
    cached.charAt(0) !== '['
  ) {
    return cached as unknown as T;
  }

  const parsed = JSON.parse(cached);
  if (
    !parsed ||
    (typeof parsed === 'object' && Object.keys(parsed).length === 0)
  ) {
    throw new Error('Cached value is empty or invalid');
  }
  return parsed as T;
}
