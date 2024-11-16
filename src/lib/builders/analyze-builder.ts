import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, LanguageModelV1 } from 'ai';
import { log } from '../queueLib';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../database/queries';
import { builderProfilePrompt } from '../prompts/builder-profile';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import crypto from 'crypto';
import { filterCasts, generateCastText } from './utils';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const googleAiStudioKey = process.env.GOOGLE_AI_STUDIO_KEY;

if (!anthropicApiKey || !openaiApiKey || !googleAiStudioKey) {
  throw new Error('Anthropic or OpenAI API key not found');
}

const anthropic = createAnthropic({
  apiKey: anthropicApiKey,
});

const openai = createOpenAI({
  apiKey: openaiApiKey,
});

const googleAiStudio = createGoogleGenerativeAI({
  apiKey: googleAiStudioKey,
});

const anthropicModel = anthropic('claude-3-5-sonnet-20241022');
const openAIModel = openai('gpt-4o');
const googleAiStudioModel = googleAiStudio('gemini-1.5-pro');

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
  const BATCH_SIZE = 1500;

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
    // Define models to try in order

    const response = await retryWithExponentialBackoff(
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
      [openAIModel, googleAiStudioModel]
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
  const response = await retryWithExponentialBackoff(
    (model) => () =>
      generateText({
        model,
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
    job,
    [openAIModel, googleAiStudioModel]
  );

  const finalSummary = response.text;

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
  fnFactory: (model: any) => () => Promise<T>,
  job: Job,
  models: LanguageModelV1[],
  retries: number = 4,
  delay: number = 20000,
  modelIndex: number = 0
): Promise<T> {
  const currentModel = models[modelIndex];

  try {
    return await fnFactory(currentModel)();
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
      error.message?.includes('too_many_requests') ||
      error.message?.includes('rate limit') ||
      error.message?.includes('429');

    const status = error?.status || error?.code || 'Unknown';
    log(
      `Error with model ${currentModel}: ${error.message}. Status: ${status}. Retries left: ${retries}`,
      job
    );

    if (isRateLimitError(error) && modelIndex + 1 < models.length) {
      // Switch to the next model
      const nextModelIndex = modelIndex + 1;
      log(
        `Switching to model ${models[
          nextModelIndex
        ].toString()} due to rate limit`,
        job
      );
      return retryWithExponentialBackoff(
        fnFactory,
        job,
        models,
        retries,
        delay,
        nextModelIndex
      );
    } else if (retries > 0 && isTransientError) {
      const retryDelay = isRateLimitError(error) ? delay * 4 : delay * 2;
      log(`Retrying after ${retryDelay} ms with model ${currentModel}...`, job);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return retryWithExponentialBackoff(
        fnFactory,
        job,
        models,
        retries - 1,
        retryDelay,
        modelIndex
      );
    } else {
      throw error;
    }
  }
}

function isRateLimitError(error: any): boolean {
  // Check error message patterns for different providers
  const errorMessage = error.message?.toLowerCase() || '';
  return (
    // OpenAI patterns
    errorMessage.includes('too_many_requests') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('429') ||
    // Google patterns
    errorMessage.includes('resource_exhausted') ||
    errorMessage.includes('quota exceeded') ||
    // Anthropic patterns
    errorMessage.includes('rate_limit_error') ||
    errorMessage.includes('too_many_requests') ||
    // Generic status code check
    error.status === 429 ||
    error.code === 429
  );
}
