import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { log } from '../queueLib';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../database/queries';
import { builderProfilePrompt } from '../prompts/builder-profile';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import crypto from 'crypto';
import { filterCasts, generateCastText } from './utils';

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
const anthropic = createAnthropic({
  apiKey: anthropicApiKey,
});

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

  const castsText: string[] = [];
  const BATCH_SIZE = 1000;

  // Generate text representations of casts in batches
  for (let i = 0; i < sortedCasts.length; i += BATCH_SIZE) {
    const batch = sortedCasts.slice(i, i + BATCH_SIZE);
    log(
      `Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(
        sortedCasts.length / BATCH_SIZE
      )}`,
      job
    );

    const batchTexts = await Promise.all(
      batch.map(async (cast) => {
        if (!cast.timestamp || (!cast.text && !cast.embeds)) {
          console.error('Cast timestamp is required', cast);
          return null;
        }
        return generateCastText(cast, redisClient, job);
      })
    );

    castsText.push(
      ...batchTexts.filter((text): text is string => text !== null)
    );
  }

  // Sanitize and filter empty entries
  const sanitizedCastsText = castsText.filter((text) => text.trim() !== '');

  if (sanitizedCastsText.length === 0) {
    log('No messages to analyze', job);
    return 'No messages available for analysis.';
  }

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
    const { text } = await retryWithExponentialBackoff(async () => {
      const response = await generateText({
        model: anthropic('claude-3-5-sonnet-20241022'),
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
      });
      return response;
    }, job);

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
async function summarizeAnalysis(
  combinedAnalysis: string,
  job: Job,
  redisClient: RedisClientType
): Promise<string> {
  log(`Summarizing analysis for multiple chunks of data`, job);

  // Check cache first using hash of combined analysis
  const cacheKey = `summary-analysis-v1:${crypto
    .createHash('sha256')
    .update(combinedAnalysis)
    .digest('hex')}`;

  const existingSummary = await getCachedResult<string>(
    redisClient,
    cacheKey,
    ''
  );
  if (existingSummary) {
    log(`Found cached summary analysis`, job);
    return existingSummary;
  }

  // Combine partial summaries into the final summary
  const { text: finalSummary } = await retryWithExponentialBackoff(
    async () =>
      generateText({
        model: anthropic('claude-3-5-sonnet-20241022'),
        messages: [
          {
            role: 'system',
            content: `Combine the following summaries into one comprehensive builder profile.
            The chunks are ordered from oldest to newest, and the newer chunks might have less information, but are more important because they are more recent.
            Do not mention that you are combining the chunks or otherwise summarizing them in your response, just analyze the data and return it in the format requested defined by the prompt below:
${builderProfilePrompt()}`,
          },
          {
            role: 'user',
            content: `Here are the summaries:\n\n${combinedAnalysis}`,
          },
        ],
        maxTokens: 4096,
      }),
    job
  );

  // Cache the summary
  await cacheResult<string>(
    redisClient,
    cacheKey,
    '',
    async () => finalSummary,
    true
  );

  return finalSummary;
}

async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  job: Job,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const transientErrorCodes = [
      'ENOTFOUND',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      // Add other transient error codes as needed
    ];

    const isTransientError =
      transientErrorCodes.includes(error.code) ||
      error.status >= 500 ||
      error.message?.includes('too_many_requests') || // Anthropic rate limit error
      error.message?.includes('rate limit') ||
      error.message?.includes('429'); // HTTP 429 Too Many Requests

    const status = error?.status || error?.code || 'Unknown';
    log(
      `Error during operation: ${error.message}. Status: ${status}. Retries left: ${retries}`,
      job
    );

    if (retries > 0 && isTransientError) {
      // Use longer delay for rate limit errors
      const retryDelay =
        error.message?.includes('too_many_requests') ||
        error.message?.includes('rate limit') ||
        error.message?.includes('429')
          ? delay * 4 // Quadruple delay for rate limits
          : delay * 2;

      log(`Retrying after ${retryDelay} ms...`, job);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return retryWithExponentialBackoff(fn, job, retries - 1, retryDelay);
    } else {
      throw error;
    }
  }
}
