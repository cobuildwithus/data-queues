import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { IsGrantUpdateJobBody } from '../../types/job';
import { fetchEmbeddingSummaries } from '../queueLib';
import { RedisClientType } from 'redis';

const anthropic = createAnthropic({
  apiKey: `${process.env.ANTHROPIC_API_KEY}`,
});

const CAST_ANALYSIS_CACHE_PREFIX = 'cast-analysis:';

interface CastAnalysis {
  grantId?: string;
  isGrantUpdate: boolean;
  reason: string;
  confidenceScore: number;
  castHash: string;
}

async function getCachedCastAnalysis(
  redisClient: RedisClientType,
  castHash: string,
  grantId: string
): Promise<CastAnalysis | null> {
  const cached = await redisClient.get(
    `${CAST_ANALYSIS_CACHE_PREFIX}${castHash}:${grantId}`
  );
  return cached ? JSON.parse(cached) : null;
}

async function cacheCastAnalysis(
  redisClient: RedisClientType,
  castHash: string,
  grantId: string,
  analysis: CastAnalysis
): Promise<void> {
  await redisClient.set(
    `${CAST_ANALYSIS_CACHE_PREFIX}${castHash}:${grantId}`,
    JSON.stringify(analysis)
  );
}

export async function analyzeCast(
  redisClient: RedisClientType,
  job: IsGrantUpdateJobBody
): Promise<CastAnalysis> {
  if (!job.castContent && job.urls.length === 0) {
    throw new Error('Cast content or urls are required');
  }

  // Check cache first
  const cachedAnalysis = await getCachedCastAnalysis(
    redisClient,
    job.castHash,
    job.grantId
  );
  if (cachedAnalysis) {
    console.log('Returning cached cast analysis', job.castHash);
    return cachedAnalysis;
  }

  const summaries = await fetchEmbeddingSummaries(redisClient, job.urls);

  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: z.object({
      grantId: z.string().optional(),
      isGrantUpdate: z.boolean(),
      reason: z.string().describe("Reason for why it's a grant update, or not"),
      confidenceScore: z
        .number()
        .describe("Confidence score whether it's a grant update or not"),
    }),
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant that analyzes text & images of Farcaster cast to determine if it should be included on the specific Grant page in the "Updates" section. 
        You will be given a cast and grant details. 
        You will need to determine if the cast is a status update for the grant. 
        If it is, you will need to return the grantId and your confidence score why you think this cast is an update for this specific grant. 
        If the cast is not a grant update - return an empty grantId. 
        If the cast is generic comment about grants program - return an empty grantId. 
        Feel free to infer or otherwise make basic logical assumptions to determine if the cast is a grant update. 
        Eg: if someone posts about buying supplies but doesn't mention the grant, you can assume it's an update for the grant. 
        The cast includes some images.
        Pay special attention to the requirements of the parent flow, which dictate what types of work are eligible for the grant, and should
        inform whether or not the cast should be counted as an update on work done for the grant.
        If the cast content is not provided, there must be attachments to determine if it's a grant update.
        If the grant description has some details about side projects or other work the builder is involved in,
        you should make sure not to count any information in the cast that relates to that side work.
        The cast must be specifically related to the grant to be counted as an update.

        Grant Details:
        Grant ID: ${job.grantId}
        Description: ${job.grantDescription}
        Parent Flow Description: ${job.parentFlowDescription}
        ${
          summaries.length
            ? `The update contains attachments: ${summaries.join(', ')}`
            : 'The update contains no attachments'
        }`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: job.castContent || 'NO CAST CONTENT PROVIDED' },
        ],
      },
    ],
    maxTokens: 1500,
  });

  const result: CastAnalysis = { ...object, castHash: job.castHash };

  // Cache the analysis
  await cacheCastAnalysis(redisClient, job.castHash, job.grantId, result);

  return result;
}
