import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { DeletionJobBody, JobBody } from './types/job';
import { createClient } from 'redis';
import OpenAI from 'openai';
import { embeddings } from './database/schema';
import { db } from './database/db';
import { and, eq } from 'drizzle-orm';
import {
  updateJobProgress,
  log,
  storeJobId,
  getEmbedding,
  storeEmbedding,
  handleContentHash,
  contentHashPrefix,
} from './lib/queueLib';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required');
}

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is required');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const connection: ConnectionOptions = {
  url: process.env.REDIS_URL,
};

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

let redisConnected = false;
const ensureRedisConnected = async () => {
  if (!redisConnected) {
    console.log('Connecting to Redis...');
    console.log(process.env.REDIS_URL);
    await redisClient.connect();
    redisConnected = true;
  }
};

export const createQueue = <T = JobBody>(name: string) =>
  new Queue<T>(name, { connection });

export const setupQueueProcessor = async <T = JobBody>(queueName: string) => {
  await ensureRedisConnected();

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
        data.urls
      );
      log(`Generated embedding with ${embedding.length} dimensions`, job);
      await storeEmbedding(embedding, input, urlSummaries, data, contentHash);

      await updateJobProgress(job, 'embeddings', 100);

      await updateJobProgress(job, 'redis', 0);

      await storeJobId(redisClient, jobId, contentHash);

      await updateJobProgress(job, 'redis', 100);

      return { jobId, contentHash, message: 'Successfully added embedding' };
    },
    { connection, concurrency: 50 }
  );
};

export const setupBulkQueueProcessor = async <T = JobBody>(
  queueName: string
) => {
  await ensureRedisConnected();

  new Worker<T[]>(
    queueName,
    async (jobs: Job<T[]>) => {
      const jobId = jobs.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const results = [];
      const data = jobs.data as JobBody[];

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
          openai,
          item.content,
          item.urls
        );
        log(
          `Generated embedding ${i + 1}/${data.length} with ${
            embedding.length
          } dimensions for content: ${input.substring(0, 50)}...`,
          jobs
        );

        await storeEmbedding(embedding, input, urlSummaries, item, contentHash);
        await storeJobId(redisClient, jobId, contentHash);

        results.push({
          jobId,
          contentHash,
          message: 'Successfully added embedding',
        });
      }

      await updateJobProgress(jobs, 'processing', 100);

      return results;
    },
    { connection, concurrency: 9 }
  );
};

export const setupDeletionQueueProcessor = async (queueName: string) => {
  await ensureRedisConnected();

  new Worker(
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
      await redisClient.del(`${contentHashPrefix}${contentHash}`);

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
