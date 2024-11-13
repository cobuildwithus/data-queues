import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { IsGrantUpdateJobBody } from '../types/job';
import { log } from '../lib/queueLib';
import { analyzeCast } from '../lib/casts/analyze-cast';
import { RedisClientType } from 'redis';
import { farcasterCasts } from '../database/farcaster-schema';
import { farcasterDb } from '../database/farcasterDb';
import { eq, sql } from 'drizzle-orm';

export const isGrantUpdateWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType
) => {
  new Worker<IsGrantUpdateJobBody[]>(
    queueName,
    async (job: Job<IsGrantUpdateJobBody[]>) => {
      const casts = job.data;

      if (!casts || !casts.length) {
        throw new Error('Cast data is required');
      }

      try {
        const results = [];
        for (const cast of casts) {
          const result = await analyzeCast(redisClient, cast);

          if (result.isGrantUpdate && result.grantId) {
            // Convert the hexadecimal hash string to a Buffer
            const castHashBuffer = Buffer.from(
              cast.castHash.replace(/^0x/, ''),
              'hex'
            );

            await farcasterDb
              .update(farcasterCasts)
              .set({
                computedTags: sql`array_append(array_remove(computed_tags, ${result.grantId}), ${result.grantId})`,
              })
              .where(sql`hash = ${castHashBuffer}`);
          }

          log(
            `Analysis complete for cast: ${
              result.isGrantUpdate ? 'Is update' : 'Not update'
            } (${result.reason})`,
            job
          );

          results.push(result);
        }

        return {
          jobId: job.id,
          results,
        };
      } catch (error) {
        console.error('Error processing casts:', error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 5, // Lower concurrency since this involves AI analysis
      lockDuration: 1200000, // 20 minutes
      lockRenewTime: 600000, // 10 minutes (half of lockDuration)
    }
  );
};
