import { RedisClientType } from 'redis';
import { cacheResult, getCachedResult } from '../cache/cacheResult';

const FARCASER_AGENT_ANALYSIS_CACHE_PREFIX = 'ai-farcaster-agent-analysis-v1:';
export interface FarcasterAgentAnalysis {
  shouldReply: boolean;
  proposedReply: string;
  reason: string;
  confidenceScore: number;
  replyToCastId: number | null;
  agentFid: number;
  customInstructions: string;
}

export async function getCachedAgentAnalysis(
  redisClient: RedisClientType,
  castHash: Buffer
): Promise<FarcasterAgentAnalysis | null> {
  return await getCachedResult<FarcasterAgentAnalysis>(
    redisClient,
    `${castHash.toString('hex')}`,
    FARCASER_AGENT_ANALYSIS_CACHE_PREFIX
  );
}

export async function cacheAgentAnalysis(
  redisClient: RedisClientType,
  castHash: Buffer,
  analysis: FarcasterAgentAnalysis
): Promise<void> {
  await cacheResult(
    redisClient,
    `${castHash.toString('hex')}`,
    FARCASER_AGENT_ANALYSIS_CACHE_PREFIX,
    async () => analysis
  );
}
