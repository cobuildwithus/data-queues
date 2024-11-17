import { Job } from 'bullmq';
import { log } from '../../queueLib';
import { cacheResult, getCachedResult } from '../../cache/cacheResult';
import { RedisClientType } from 'redis';

const IMAGE_DESCRIPTION_CACHE_PREFIX = 'ai-studio-image-description:';

export async function getCachedImageDescription(
  redisClient: RedisClientType,
  imageUrl: string,
  job: Job
): Promise<string | null> {
  log(`Checking cache for image description: ${imageUrl}`, job);
  return await getCachedResult<string>(
    redisClient,
    imageUrl,
    IMAGE_DESCRIPTION_CACHE_PREFIX
  );
}

export async function cacheImageDescription(
  redisClient: RedisClientType,
  imageUrl: string,
  description: string,
  job: Job
): Promise<void> {
  log(`Caching image description for: ${imageUrl}`, job);
  await cacheResult(
    redisClient,
    imageUrl,
    IMAGE_DESCRIPTION_CACHE_PREFIX,
    async () => description
  );
  log('Image description cached successfully', job);
}
