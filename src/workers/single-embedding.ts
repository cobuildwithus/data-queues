import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { JobBody } from '../types/job';
import { getEmbedding } from '../lib/embedding/get';
import { log } from '../lib/helpers';
import { updateJobProgress } from '../lib/helpers';
import {
  handleContentHash,
  storeEmbeddingJobRun,
} from '../lib/embedding/cache';
import OpenAI from 'openai';
import { RedisClientType } from 'redis';
import { storeEmbedding } from '../lib/embedding/store';

export const singleEmbeddingWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType,
  openai: OpenAI
) => {
  new Worker<JobBody>(
    queueName,
    async (job: Job<JobBody>) => {
      const jobId = job.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      await updateJobProgress(job, 'hash', 0);

      const data = job.data as JobBody;
      const { exists, contentHash } = await handleContentHash(
        redisClient,
        data
      );

      if (exists) {
        log('Content already processed, skipping...', job);
        return {
          jobId,
          hash: contentHash,
          message: 'Content already processed',
        };
      }

      await updateJobProgress(job, 'hash', 100);

      await updateJobProgress(job, 'embeddings', 0);

      // Get embeddings for the content
      const { embedding, input, urlSummaries } = await getEmbedding(
        redisClient,
        openai,
        data.content,
        job,
        data.type,
        data.externalId,
        data.urls
      );
      log(`Generated embedding with ${embedding.length} dimensions`, job);

      await storeEmbedding(embedding, input, urlSummaries, data, contentHash);

      await updateJobProgress(job, 'embeddings', 100);

      await updateJobProgress(job, 'redis', 0);

      await storeEmbeddingJobRun(redisClient, jobId, contentHash);

      await updateJobProgress(job, 'redis', 100);

      return { jobId, contentHash, message: 'Successfully added embedding' };
    },
    { connection, concurrency: 50, lockRenewTime: 30000, lockDuration: 60000 }
  );
};
