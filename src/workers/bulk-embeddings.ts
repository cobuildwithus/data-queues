import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { JobBody } from '../types/job';
import { getEmbedding } from '../lib/embedding/get';
import { log } from '../lib/helpers';
import OpenAI from 'openai';
import { RedisClientType } from 'redis';
import { updateJobProgress } from '../lib/helpers';
import {
  handleContentHash,
  storeEmbeddingJobRun,
} from '../lib/embedding/cache';
import { storeEmbedding } from '../lib/embedding/store';

export const bulkEmbeddingsWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType,
  openai: OpenAI
) => {
  new Worker<JobBody[]>(
    queueName,
    async (jobs: Job<JobBody[]>) => {
      const jobId = jobs.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const data = jobs.data;
      const results = [];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        await updateJobProgress(jobs, 'processing', (i / data.length) * 100);

        const { exists, contentHash } = await handleContentHash(
          redisClient,
          item
        );

        if (exists) {
          log(
            `Content ${i + 1}/${data.length} already processed, skipping...`,
            jobs
          );
          results.push({
            jobId,
            hash: contentHash,
            message: 'Content already processed',
          });
          continue;
        }

        const { embedding, input, urlSummaries } = await getEmbedding(
          redisClient,
          openai,
          item.content,
          jobs,
          item.type,
          item.externalId,
          item.urls
        );

        log(
          `Generated embedding ${i + 1}/${data.length} with ${
            embedding.length
          } dimensions for content: ${input.substring(0, 50)}...`,
          jobs
        );

        await storeEmbedding(embedding, input, urlSummaries, item, contentHash);

        await storeEmbeddingJobRun(redisClient, jobId, contentHash);

        results.push({
          jobId,
          contentHash,
          message: 'Successfully added embedding',
        });
      }

      await updateJobProgress(jobs, 'processing', 100);

      return results;
    },
    {
      connection,
      concurrency: 30, // Number of jobs that can be processed simultaneously
      lockRenewTime: 3600000, // 1 hour - How often to renew the lock
      lockDuration: 7200000, // 2 hours - How long to hold the lock for
    }
  );
};
