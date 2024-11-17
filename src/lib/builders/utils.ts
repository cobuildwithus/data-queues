import { RedisClientType } from 'redis';
import { CastWithParent } from '../../database/queries';
import { Job } from 'bullmq';
import { getAndSaveUrlSummaries } from '../url-summaries/attachments';
import { cacheResult } from '../cache/cacheResult';
import { googleAiStudioModel } from '../ai';
import { anthropicModel } from '../ai';
import { log } from '../helpers';
import { getCachedResult } from '../cache/cacheResult';
import { openAIModel, retryAiCallWithBackoff } from '../ai';
import { generateText } from 'ai';
import { builderProfilePrompt } from '../prompts/builder-profile';
import crypto from 'crypto';

export async function summarizeAnalysis(
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
  const response = await retryAiCallWithBackoff(
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
    [anthropicModel, openAIModel, googleAiStudioModel]
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

const hasNoEmbeds = (cast: CastWithParent) => {
  if (!cast.embeds) {
    return true;
  }
  try {
    const embedsArray = JSON.parse(cast.embeds);
    return embedsArray.length === 0;
  } catch (error) {
    console.error('Invalid embeds JSON', error);
    return true; // Assume no embeds if parsing fails
  }
};

export const filterCasts = (casts: CastWithParent[]) => {
  return casts.filter((cast) => {
    // For replies (has parent), filter if text < 10 chars and no embeds
    if (cast.parentHash != null) {
      return !((cast.text?.length || 0) < 10 && hasNoEmbeds(cast));
    }

    // For non-replies, filter if no text and no embeds
    return !((cast.text?.length || 0) === 0 && hasNoEmbeds(cast));
  });
};

export async function generateCastText(
  cast: CastWithParent,
  redisClient: RedisClientType,
  job: Job
): Promise<string> {
  if (!cast.timestamp) {
    throw new Error('Cast timestamp is required');
  }

  const embedSummaries = await getAndSaveUrlSummaries(
    cast.embeds,
    cast.embedSummaries,
    cast.id,
    redisClient,
    job
  );

  let parentEmbedSummaries: string[] = [];

  if (cast.parentCast && cast.parentCast.id) {
    parentEmbedSummaries = await getAndSaveUrlSummaries(
      cast.parentCast.embeds,
      cast.parentCast.embedSummaries,
      cast.parentCast.id,
      redisClient,
      job
    );
  }

  const contentText = cast.text ? `CONTENT: ${cast.text}` : '';

  const parentAuthor = cast.parentCast?.fname
    ? `AUTHOR: ${cast.parentCast.fname}`
    : '';
  const parentContent = cast.parentCast?.text
    ? `CONTENT: ${cast.parentCast.text}`
    : '';

  return `TIMESTAMP: ${new Date(cast.timestamp).toISOString()}
${contentText}
${embedSummaries.length ? `ATTACHMENTS: ${embedSummaries.join(' | ')}` : ''}
${
  cast.parentCast?.text
    ? `PARENT_CAST: {
  ${parentAuthor}
  ${parentContent}
  ${
    parentEmbedSummaries.length
      ? `ATTACHMENTS: ${parentEmbedSummaries.join(' | ')}`
      : ''
  }
}`
    : ''
}
---`;
}

export function safeTrim(text: string | null | undefined): string {
  if (text === null || text === undefined) {
    return '';
  }
  if (typeof text === 'string') {
    return text.trim();
  }
  throw new Error(
    `Text ${JSON.stringify(text)} is not a string that can be trimmed`
  );
}
