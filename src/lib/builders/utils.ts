import { RedisClientType } from 'redis';
import { CastWithParent } from '../../database/queries';
import { Job } from 'bullmq';
import { getAndSaveEmbedSummaries } from '../multi-media/get-and-save-summaries';

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

  const embedSummaries = await getAndSaveEmbedSummaries(cast, redisClient, job);

  let parentEmbedSummaries: string[] = [];

  if (cast.parentCast) {
    parentEmbedSummaries = await getAndSaveEmbedSummaries(
      cast.parentCast,
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

export function safeTrim(text: string) {
  if (typeof text === 'string') {
    return text.trim();
  } else {
    throw new Error(
      `Text ${JSON.stringify(text)} is not a string that can be trimmed`
    );
  }
}
