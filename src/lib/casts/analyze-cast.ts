import { generateObject } from 'ai';
import { z } from 'zod';
import { IsGrantUpdateJobBody } from '../../types/job';
import { log } from '../helpers';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { anthropicModel, retryAiCallWithBackoff } from '../ai';
import { googleAiStudioModel, openAIModel } from '../ai';
import { cacheCastAnalysis, CastAnalysis } from './cache';
import { getCachedCastAnalysis } from './cache';
import { getMessageContent } from './utils';
import { saveUrlSummariesForCastHash } from '../url-summaries/attachments';

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

  const summaries = await saveUrlSummariesForCastHash(
    data.castHash,
    data.urls,
    redisClient,
    job
  );

  const { object } = await retryAiCallWithBackoff(
    (model) => () =>
      generateObject({
        model,
        schema: z.object({
          grantId: z.string().optional(),
          isGrantUpdate: z.boolean(),
          reason: z
            .string()
            .describe("Reason for why it's a grant update, or not"),
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
      }),
    job,
    [anthropicModel, openAIModel, googleAiStudioModel]
  );

  const result: CastAnalysis = { ...object, castHash: data.castHash };

  // Cache the analysis
  await cacheCastAnalysis(redisClient, data.castHash, data.grantId, result);

  return result;
}
