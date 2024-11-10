import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { DeletionJobBody, JobBody } from './types/job';
import { createClient } from 'redis';
import OpenAI from 'openai';
import { embeddings } from './database/schema';
import { db } from './database/db';
import { and, eq } from 'drizzle-orm';

const version = 17;

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
      const { exists, contentHash } = await handleContentHash(data);

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
      const embedding = await getEmbedding(data.content);
      log(`Generated embedding with ${embedding.length} dimensions`, job);
      await storeEmbedding(embedding, data, contentHash);

      await updateJobProgress(job, 'embeddings', 100);

      await updateJobProgress(job, 'redis', 0);

      await storeJobId(jobId, contentHash);

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
    async (job: Job<T[]>) => {
      const jobId = job.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const results = [];
      const data = job.data as JobBody[];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        await updateJobProgress(job, 'processing', (i / data.length) * 100);

        const { exists, contentHash } = await handleContentHash(item);

        if (exists) {
          log(
            `Content ${i + 1}/${data.length} already processed, skipping...`,
            job
          );
          results.push({
            jobId,
            hash: contentHash,
            message: 'Content already processed',
          });
          continue;
        }

        const embedding = await getEmbedding(item.content);
        log(
          `Generated embedding ${i + 1}/${data.length} with ${
            embedding.length
          } dimensions`,
          job
        );

        await storeEmbedding(embedding, item, contentHash);
        await storeJobId(jobId, contentHash);

        results.push({
          jobId,
          contentHash,
          message: 'Successfully added embedding',
        });
      }

      await updateJobProgress(job, 'processing', 100);

      return results;
    },
    { connection, concurrency: 50 }
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

const storeJobId = async (jobId: string, contentHash: string) => {
  await redisClient.set(`${contentHashPrefix}${contentHash}`, jobId);
};

// check redis for the content hash
// if it exists, return the existing hash
// if it doesn't exist, create a new hash and store it in redis
// return the new hash
export const getContentHash = async (
  content: string,
  type: string,
  hashSuffix?: string
) => {
  const contentHash = createHash('sha256')
    .update(`${type}-${content}-${hashSuffix ?? ''}`)
    .digest('hex');
  return contentHash;
};

export const getEmbedding = async (text: string): Promise<number[]> => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.replace('\n', ' '),
  });

  return response.data[0].embedding;
};

// log function that console.logs and job logs
export const log = (message: string, job: Job) => {
  // if dev, console.log
  if (process.env.NODE_ENV === 'development') {
    console.log(message);
  }
  job.log(message);
};

// Helper to update job progress
const updateJobProgress = async (job: Job, phase: string, progress: number) => {
  await job.updateProgress({
    phase,
    progress,
  });
};

const contentHashPrefix = `v${version}-content:`;

// Helper to check and store content hash
const handleContentHash = async (job: JobBody) => {
  const contentHash = await getContentHash(
    job.content,
    job.type,
    job.hashSuffix
  );
  const existingJobId = await redisClient.get(
    `${contentHashPrefix}${contentHash}`
  );

  if (existingJobId) {
    return { exists: true, jobId: existingJobId, contentHash };
  }

  return { exists: false, jobId: null, contentHash };
};

const storeEmbedding = async (
  embedding: number[],
  job: JobBody,
  contentHash: string
) => {
  await db
    .insert(embeddings)
    .values({
      id: crypto.randomUUID(),
      type: job.type,
      content: job.content,
      contentHash: contentHash,
      embedding: embedding,
      version: version,
      groups: job.groups.map((group) => group.toLowerCase()),
      users: job.users.map((user) => user.toLowerCase()),
      tags: job.tags.map((tag) => tag.toLowerCase()),
      externalId: job.externalId,
    })
    .onConflictDoNothing();
};
