import { Job } from 'bullmq';
import { log } from '../../queueLib';
import { RedisClientType } from 'redis';
import { cacheResult, getCachedResult } from '../../cache/cacheResult';

const VIDEO_DESCRIPTION_CACHE_PREFIX = 'ai-studio-video-description:';

export async function getCachedVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string,
  job: Job
): Promise<string | null> {
  log(`Checking cache for video description: ${videoUrl}`, job);
  return await getCachedResult<string>(
    redisClient,
    videoUrl,
    VIDEO_DESCRIPTION_CACHE_PREFIX
  );
}

export async function cacheVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string,
  description: string,
  job: Job
): Promise<void> {
  log(`Caching video description for: ${videoUrl}`, job);
  await cacheResult(
    redisClient,
    videoUrl,
    VIDEO_DESCRIPTION_CACHE_PREFIX,
    async () => description
  );
  log('Video description cached successfully', job);
}
