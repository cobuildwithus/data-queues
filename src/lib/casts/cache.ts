import { RedisClientType } from 'redis';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import { Cast } from '../../database/queries/casts/get-cast';

const CAST_ANALYSIS_CACHE_PREFIX = 'ai-cast-analysis-v3:';

export interface CastAnalysis {
  grantId: string;
  isGrantUpdate: boolean;
  reason: string;
  confidenceScore: number;
  castHash: string;
  shouldRequestMoreInfo: boolean;
  cast: Cast;
}

export async function getCachedCastAnalysis(
  redisClient: RedisClientType,
  castHash: Buffer
): Promise<CastAnalysis | null> {
  return await getCachedResult<CastAnalysis>(
    redisClient,
    `${castHash.toString('hex')}`,
    CAST_ANALYSIS_CACHE_PREFIX
  );
}

export async function cacheCastAnalysis(
  redisClient: RedisClientType,
  castHash: Buffer,
  analysis: CastAnalysis
): Promise<void> {
  await cacheResult(
    redisClient,
    `${castHash.toString('hex')}`,
    CAST_ANALYSIS_CACHE_PREFIX,
    async () => analysis
  );
}
