import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { DeletionJobBody } from '../types/job';
import { embeddings } from '../database/schema';
import { db } from '../database/db';
import { and, eq } from 'drizzle-orm';
import { log } from '../lib/helpers';
import { RedisClientType } from 'redis';
import { updateJobProgress } from '../lib/helpers';
import { deleteContentHash } from '../lib/embedding/cache';

export const deletionQueueWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType
) => {
  new Worker<DeletionJobBody>(
    queueName,
    async (job: Job<DeletionJobBody>) => {
      const jobId = job.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const { contentHash, type } = job.data;

      await updateJobProgress(job, 'deletion', 0);

      // Delete from database
      await db
        .delete(embeddings)
        .where(
          and(
            eq(embeddings.contentHash, contentHash),
            eq(embeddings.type, type)
          )
        );

      // Delete from Redis
      await deleteContentHash(redisClient, contentHash);

      await updateJobProgress(job, 'deletion', 100);

      log(`Deleted embedding with hash ${contentHash} and type ${type}`, job);

      return {
        jobId,
        contentHash,
        type,
        message: 'Successfully deleted embedding',
      };
    },
    { connection }
  );
};
