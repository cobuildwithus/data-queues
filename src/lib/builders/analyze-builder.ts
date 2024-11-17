import { generateText } from 'ai';
import { log } from '../helpers';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../database/queries';
import { builderProfilePrompt } from '../prompts/builder-profile';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import crypto from 'crypto';
import { filterCasts, summarizeAnalysis } from './utils';
import {
  googleAiStudioModel,
  openAIModel,
  anthropicModel,
  retryAiCallWithBackoff,
} from '../ai';
import { processCasts } from './batch-process-casts';

const CASTS_PER_CHUNK = 650; // Fixed number of casts per chunk

const BUILDER_CACHE_KEY = 'builder-profile-analyze-chunk:';

export async function generateBuilderProfile(
  casts: CastWithParent[],
  redisClient: RedisClientType,
  job: Job
) {
  log(`Processing ${casts.length} casts`, job);
  // Filter out casts that are not original posts and have no meaningful content
  const sortedCasts = filterCasts(casts);

  // Sanitize and filter empty entries
  const sanitizedCastsText = await processCasts(sortedCasts, redisClient, job);

  // Split casts into fixed-size chunks
  const totalCasts = sanitizedCastsText.length;
  const chunks: string[][] = [];

  for (let i = 0; i < totalCasts; i += CASTS_PER_CHUNK) {
    const chunkCasts = sanitizedCastsText.slice(i, i + CASTS_PER_CHUNK);
    chunks.push(chunkCasts);
  }

  const partialAnalyses: string[] = [];

  // Process each chunk individually
  for (let i = 0; i < chunks.length; i++) {
    const chunkCasts = chunks[i];
    const chunk = chunkCasts.join('\n');

    // Use chunk index and hash for cache key
    const chunkHash = crypto.createHash('sha256').update(chunk).digest('hex');
    const cacheKey = `${BUILDER_CACHE_KEY}${i}-${chunkHash}`;
    log(`Cache key: ${cacheKey}`, job);

    const existingAnalysis = await getCachedResult<string>(
      redisClient,
      cacheKey,
      '',
      true
    );

    if (existingAnalysis) {
      log(`Found cached analysis for chunk ${i + 1}`, job);
      partialAnalyses.push(existingAnalysis);
      continue;
    }

    // Generate analysis for the chunk
    log(`Analyzing chunk ${i + 1} of ${chunks.length}`, job);
    // Define models to try in order

    const response = await retryAiCallWithBackoff(
      (model) => () =>
        generateText({
          model,
          messages: [
            {
              role: 'system',
              content: builderProfilePrompt(),
            },
            {
              role: 'user',
              content: `Here are the posts:\n\n${chunk}`,
            },
          ],
          maxTokens: 4096,
        }),
      job,
      [anthropicModel, openAIModel, googleAiStudioModel]
    );
    const { text } = response;

    // Cache the analysis
    await cacheResult<string>(
      redisClient,
      cacheKey,
      '',
      async () => text,
      true
    );

    partialAnalyses.push(text);
  }

  // Combine partial analyses and generate final summary
  log(`Combining partial analyses`, job);
  const combinedAnalysis = partialAnalyses.join('\n\n');

  const didChunk = chunks.length > 1;

  log(`Did chunk: ${didChunk}`, job);

  if (!didChunk) {
    return partialAnalyses[0];
  }

  const finalSummary = await summarizeAnalysis(
    combinedAnalysis,
    job,
    redisClient
  );

  return finalSummary;
}
