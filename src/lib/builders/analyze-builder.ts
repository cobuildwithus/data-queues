import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { log } from '../queueLib';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../database/queries';
import { getAndSaveEmbedSummaries } from '../multi-media/get-and-save-summaries';
import { builderProfilePrompt } from '../prompts/builder-profile';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import crypto from 'crypto';

const anthropic = createAnthropic({
  apiKey: `${process.env.ANTHROPIC_API_KEY}`,
});

const BATCH_SIZE = 250; // Process 250 casts at a time
const MAX_CHUNK_SIZE = 250000; // Maximum characters per chunk

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

  // Process casts in batches
  for (let i = 0; i < sortedCasts.length; i += BATCH_SIZE) {
    const batchCasts = sortedCasts.slice(i, i + BATCH_SIZE);

    // Process batch concurrently
    const batchResults = await Promise.all(
      batchCasts.map(async (cast) => {
        if (!cast.timestamp || (!cast.text && !cast.embeds)) {
          console.error('Cast timestamp is required', cast);
          return '';
        }

        const embedSummaries = await getAndSaveEmbedSummaries(
          cast,
          redisClient,
          job
        );
        let parentEmbedSummaries: string[] = [];

        if (cast.parentCast) {
          parentEmbedSummaries = await getAndSaveEmbedSummaries(
            cast.parentCast,
            redisClient,
            job
          );
        }

        return `TIMESTAMP: ${new Date(cast.timestamp).toISOString()}
CONTENT: ${cast.text}
${embedSummaries.length ? `ATTACHMENTS: ${embedSummaries.join(' | ')}` : ''}
${
  cast.parentCast?.text
    ? `PARENT_CAST: {
  AUTHOR: ${cast.parentCast.fname}
  CONTENT: ${cast.parentCast.text}
  ${
    parentEmbedSummaries.length
      ? `ATTACHMENTS: ${parentEmbedSummaries.join(' | ')}`
      : ''
  }
}`
    : ''
}
---`;
      })
    );

    castsText.push(...batchResults);
  }

  // Sanitize and filter empty entries
  const sanitizedCastsText = castsText.filter((text) => text.trim() !== '');

  if (sanitizedCastsText.length === 0) throw new Error('No message to analyze');

  // Combine all castsText into one large string
  const combinedCastsText = sanitizedCastsText.join('\n');

  // Check if the combined text exceeds the max chunk size
  if (combinedCastsText.length > MAX_CHUNK_SIZE) {
    // Calculate the number of chunks needed
    const numChunks = Math.ceil(combinedCastsText.length / MAX_CHUNK_SIZE);

    // Split the castsText into chunks
    const chunkSize = Math.ceil(sanitizedCastsText.length / numChunks);
    const chunks: string[][] = [];

    for (let i = 0; i < sanitizedCastsText.length; i += chunkSize) {
      chunks.push(sanitizedCastsText.slice(i, i + chunkSize));
    }

    const partialAnalyses: string[] = [];

    // Process each chunk individually
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].join('\n');
      log(`Analyzing chunk ${i + 1} of ${chunks.length}`, job);

      const chunkHash = crypto.createHash('sha256').update(chunk).digest('hex');

      const existingAnalysis = await getCachedResult<string>(
        redisClient,
        chunkHash,
        BUILDER_CACHE_KEY
      );

      if (existingAnalysis) {
        log(`Found cached analysis for chunk ${i + 1}`, job);
      }

      // Generate analysis for the chunk
      const analysis =
        existingAnalysis ||
        (await cacheResult<string>(
          redisClient,
          chunkHash,
          BUILDER_CACHE_KEY,
          async () => {
            const { text } = await generateText({
              model: anthropic('claude-3-sonnet-20240229'),
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
            return text;
          }
        ));

      partialAnalyses.push(analysis);
    }

    // Combine partial analyses and generate final summary
    log(`Combining partial analyses`, job);
    const combinedAnalysis = partialAnalyses.join('\n\n');

    const { text: finalSummary } = await generateText({
      model: anthropic('claude-3-sonnet-20240229'),
      messages: [
        {
          role: 'system',
          content: `Combine and summarize the following analyses into a single comprehensive builder profile. The final profile should be organized into the sections specified earlier.
The chunks are ordered chronologically, so make sure to keep that in mind when summarizing.
Do not include any other text than the final summary.
${builderProfilePrompt()}`,
        },
        {
          role: 'user',
          content: `Here are the analyses:\n\n${combinedAnalysis}`,
        },
      ],
      maxTokens: 4096,
    });

    return finalSummary;
  } else {
    // If combined text is within size limit, proceed as usual
    log(`Analyzing full text`, job);
    const { text } = await generateText({
      model: anthropic('claude-3-sonnet-20240229'),
      messages: [
        {
          role: 'system',
          content: builderProfilePrompt(),
        },
        {
          role: 'user',
          content: `Here are the posts:\n\n${combinedCastsText}`,
        },
      ],
      maxTokens: 4096,
    });

    return text;
  }
}

const hasNoEmbeds = (cast: CastWithParent) => {
  return !cast.embeds || JSON.parse(cast.embeds || '[]').length === 0;
};

const filterCasts = (casts: CastWithParent[]) => {
  return casts.filter((cast) => {
    // For replies (has parent), filter if text < 10 chars and no embeds
    if (cast.parentHash !== null) {
      return !((cast.text?.length || 0) < 10 && hasNoEmbeds(cast));
    }

    // For non-replies, filter if no text and no embeds
    return !((cast.text?.length || 0) === 0 && hasNoEmbeds(cast));
  });
};
