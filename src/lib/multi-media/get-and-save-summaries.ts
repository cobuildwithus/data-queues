import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../database/queries';
import { farcasterDb } from '../../database/farcasterDb';
import { eq } from 'drizzle-orm';

import { fetchEmbeddingSummaries, log } from '../queueLib';
import { farcasterCasts } from '../../database/farcaster-schema';

export async function getAndSaveEmbedSummaries(
  cast: Omit<CastWithParent['parentCast'], 'fname'>,
  redisClient: RedisClientType,
  job: Job
) {
  if (!cast.embeds) return [];

  const embedUrls = JSON.parse(cast.embeds).map(
    (embed: { url: string }) => embed.url
  );
  const numEmbedSummaries = cast.embedSummaries?.length || 0;
  const hasEmbedSummariesSaved = numEmbedSummaries > 0;

  const newEmbedSummaries =
    hasEmbedSummariesSaved && cast.embedSummaries
      ? cast.embedSummaries
      : await fetchEmbeddingSummaries(redisClient, job, embedUrls);

  if (!hasEmbedSummariesSaved && (newEmbedSummaries.length || 0) > 0) {
    // ensure we don't save empty embed summaries
    const nonEmptyEmbedSummaries = newEmbedSummaries.filter(
      (summary) => summary.length > 0
    );

    await farcasterDb
      .update(farcasterCasts)
      .set({ embedSummaries: nonEmptyEmbedSummaries })
      .where(eq(farcasterCasts.id, Number(cast.id)));

    log(`Saved ${newEmbedSummaries.length} embed summaries to db`, job);
  }

  return newEmbedSummaries;
}
