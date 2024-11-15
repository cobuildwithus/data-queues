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

const CASTS_PER_CHUNK = 500; // Fixed number of casts per chunk

const BUILDER_CACHE_KEY = 'builder-profile-chunk:';

export async function generateBuilderProfile(
  casts: CastWithParent[],
  redisClient: RedisClientType,
  job: Job
) {
  log(`Processing ${casts.length} casts`, job);
  // Filter out casts that are not original posts and have no meaningful content
  const sortedCasts = filterCasts(casts);

  const castsText: string[] = [];

  // Generate text representations of casts
  for (const cast of sortedCasts) {
    if (!cast.timestamp || (!cast.text && !cast.embeds)) {
      console.error('Cast timestamp is required', cast);
      continue;
    }

    const castText = await generateCastText(cast, redisClient, job);
    castsText.push(castText);
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
    const { text } = await generateText({
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

  const finalSummary = await summarizeAnalysis(combinedAnalysis, job);

  return finalSummary;
}

async function summarizeAnalysis(
  combinedAnalysis: string,
  job: Job
): Promise<string> {
  log(`Summarizing analysis for multiple chunks of data`, job);
  // Combine partial summaries into the final summary
  const { text: finalSummary } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    messages: [
      {
        role: 'system',
        content: `Combine the following summaries into one comprehensive builder profile.
        The chunks are ordered from oldest to newest, and the newer chunks might have less information, but are more important because they are more recent.
${builderProfilePrompt()}`,
      },
      {
        role: 'user',
        content: `Here are the summaries:\n\n${combinedAnalysis}`,
      },
    ],
    maxTokens: 4096,
  });

  return finalSummary;
}
