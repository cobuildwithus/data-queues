import { CastWithParent } from '../../database/queries/casts/casts-with-parent';
import { Job } from 'bullmq';
import { RedisClientType } from 'redis';
import { log } from '../helpers';
import { safeTrim } from './utils';
import { generateCastText } from '../casts/utils';

export const CAST_BATCH_SIZE = 1500;

export async function processCasts(
  casts: CastWithParent[],
  redisClient: RedisClientType,
  job: Job
) {
  const castsText: string[] = [];
  const totalBatches = Math.ceil(casts.length / CAST_BATCH_SIZE);

  // Generate text representations of casts in batches
  for (let i = 0; i < casts.length; i += CAST_BATCH_SIZE) {
    const batch = casts.slice(i, i + CAST_BATCH_SIZE);
    const batchTexts = await processCastBatch(
      batch,
      redisClient,
      job,
      Math.floor(i / CAST_BATCH_SIZE),
      totalBatches
    );
    castsText.push(...batchTexts);
  }

  // Sanitize and filter empty entries
  const sanitizedCastsText = castsText.filter((text) => safeTrim(text) !== '');

  if (sanitizedCastsText.length === 0) {
    log('No messages to analyze', job);
    return [];
  }

  return sanitizedCastsText;
}

async function processCastBatch(
  batch: CastWithParent[],
  redisClient: RedisClientType,
  job: Job,
  batchIndex: number,
  totalBatches: number
): Promise<string[]> {
  log(`Processing batch ${batchIndex + 1} of ${totalBatches}`, job);

  const batchTexts = await Promise.all(
    batch.map(async (cast) => {
      if (!cast.timestamp || (!cast.text && !cast.embeds)) {
        console.error('Cast timestamp is required', cast);
        return null;
      }
      return generateCastText(cast, redisClient, job);
    })
  );

  return batchTexts.filter((text): text is string => text !== null);
}
