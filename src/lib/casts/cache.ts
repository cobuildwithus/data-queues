import { RedisClientType } from 'redis';
import { cacheResult, getCachedResult } from '../cache/cacheResult';

const CAST_ANALYSIS_CACHE_PREFIX = 'ai-cast-analysis-v1:';

export interface CastAnalysis {
  grantId?: string;
  isGrantUpdate: boolean;
  reason: string;
  confidenceScore: number;
  castHash: string;
}

export async function getCachedCastAnalysis(
  redisClient: RedisClientType,
  castHash: string,
  grantId: string
): Promise<CastAnalysis | null> {
  return await getCachedResult<CastAnalysis>(
    redisClient,
    `${castHash}:${grantId}`,
    CAST_ANALYSIS_CACHE_PREFIX
  );
}

export async function cacheCastAnalysis(
  redisClient: RedisClientType,
  castHash: string,
  grantId: string,
  analysis: CastAnalysis
): Promise<void> {
  await cacheResult(
    redisClient,
    `${castHash}:${grantId}`,
    CAST_ANALYSIS_CACHE_PREFIX,
    async () => analysis
  );
}
