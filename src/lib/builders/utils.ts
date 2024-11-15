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
}
