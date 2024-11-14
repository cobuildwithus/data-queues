import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { IsGrantUpdateJobBody } from '../../types/job';
import { fetchEmbeddingSummaries, log } from '../queueLib';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { getCachedResult } from '../cache/cacheResult';
import { cacheResult } from '../cache/cacheResult';

const anthropic = createAnthropic({
  apiKey: `${process.env.ANTHROPIC_API_KEY}`,
});

const CAST_ANALYSIS_CACHE_PREFIX = 'ai-cast-analysis-v0:';

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
  return await getCachedResult<CastAnalysis>(
    redisClient,
    `${castHash}:${grantId}`,
    CAST_ANALYSIS_CACHE_PREFIX
  );
}

async function cacheCastAnalysis(
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

export async function analyzeCast(
  redisClient: RedisClientType,
  data: IsGrantUpdateJobBody,
  job: Job
): Promise<CastAnalysis> {
  if (!data.castContent && data.urls.length === 0) {
    throw new Error('Cast content or urls are required');
  }

  // Check cache first
  const cachedAnalysis = await getCachedCastAnalysis(
    redisClient,
    data.castHash,
    data.grantId
  );
  if (cachedAnalysis) {
    log('Returning cached cast analysis', job);
    return cachedAnalysis;
  }

  const summaries = await fetchEmbeddingSummaries(redisClient, job, data.urls);

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
        content: getMessageContent(data, summaries, job),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: data.castContent || 'NO CAST CONTENT PROVIDED',
          },
        ],
      },
    ],
    maxTokens: 1500,
  });

  const result: CastAnalysis = { ...object, castHash: data.castHash };

  // Cache the analysis
  await cacheCastAnalysis(redisClient, data.castHash, data.grantId, result);

  return result;
}

function getMessageContent(
  data: {
    castContent?: string;
    grantId: string;
    grantDescription: string;
    parentFlowDescription: string;
    castHash: string;
  },
  summaries: string[],
  job: Job
): string {
  const content = `You will need to determine if the cast is a status update for the grant. 
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
        For context, Nouns is the parent DAO that funds flows. There are sub-daos within Nouns that are like 
        mini subcultures that focus on different things. Gnars DAO is an extreme sports sub-dao that funds athletes like skaters, surfers, etc.
        Vrbs is a public-good and artists focused sub-dao that funds people and projects making local impact.
        If the cast is about work within one of these sub-cultures, you can assume it counts for the larger Nouns community, assuming the work is related to the grant.

        Grant Details:
        Grant ID: ${data.grantId}
        Description: ${data.grantDescription}
        Parent Flow Description: ${data.parentFlowDescription}
        Pay special attention to the following attachments posted by the user. 
        The attachments are either videos or images, and you should use them to determine if the cast is a grant update.
        They are described below:
        ${
          summaries.length
            ? `The update contains the following attachments posted by the user: ${summaries.join(
                ', '
              )}`
            : 'The update contains no attachments'
        }`;

  log(content, job);

  return content;
}
