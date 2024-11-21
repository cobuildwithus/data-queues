import { RedisClientType } from 'redis';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import { StoryAnalysis } from './build-story';

const STORY_CACHE_PREFIX = 'story-analysis:';

export async function getCachedStoryAnalysis(
  redisClient: RedisClientType,
  castId: number
): Promise<StoryAnalysis | null> {
  return await getCachedResult<StoryAnalysis>(
    redisClient,
    castId.toString(),
    STORY_CACHE_PREFIX
  );
}

export async function cacheStoryAnalysis(
  redisClient: RedisClientType,
  castId: number,
  analysis: StoryAnalysis
): Promise<void> {
  await cacheResult(
    redisClient,
    castId.toString(),
    STORY_CACHE_PREFIX,
    async () => analysis
  );
}
