import { Worker, Job } from 'bullmq';
import { JobBody } from '../types/job';
import {
  updateJobProgress,
  log,
  getEmbedding,
  storeEmbedding,
  handleContentHash,
  shouldGetUrlSummaries,
  storeJobId,
} from '../lib/queueLib';
import { RedisClient } from '../queue';
import OpenAI from 'openai';

export const singleEmbeddingWorker = async <T>(
  queueName: string,
  connection: any,
  redisClient: RedisClient,
  openai: OpenAI
) => {
  new Worker<T>(
    queueName,
    async (job: Job<T>) => {
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
        openai,
        data.content,
        data.urls,
        shouldGetUrlSummaries(data.groups)
      );
      log(`Generated embedding with ${embedding.length} dimensions`, job);
      await storeEmbedding(embedding, input, urlSummaries, data, contentHash);

      await updateJobProgress(job, 'embeddings', 100);

      await updateJobProgress(job, 'redis', 0);

      await storeJobId(redisClient, jobId, contentHash);

      await updateJobProgress(job, 'redis', 100);

      return { jobId, contentHash, message: 'Successfully added embedding' };
    },
    { connection, concurrency: 50, lockRenewTime: 30000, lockDuration: 60000 }
  );
};
