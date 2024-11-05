import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { JobBody } from './types/job';
import { createClient } from 'redis';
import OpenAI from 'openai';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { embeddings } from './database/schema';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL as string,
});

const version = 1;

const db = drizzle(pool);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY as string,
});

const connection: ConnectionOptions = {
  host: process.env.REDISHOST as string,
  port: Number(process.env.REDISPORT),
  username: process.env.REDISUSER as string,
  password: process.env.REDISPASSWORD as string,
};

const redisClient = createClient({
  url: `redis://${process.env.REDISHOST}:${process.env.REDISPORT}`,
  username: process.env.REDISUSER as string,
  password: process.env.REDISPASSWORD as string,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

export const createQueue = <T = JobBody>(name: string) =>
  new Queue<T>(name, { connection });

export const setupQueueProcessor = async <T = JobBody>(queueName: string) => {
  await redisClient.connect();

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
      await storeEmbedding(embedding, data);

      await updateJobProgress(job, 'embeddings', 100);

      await updateJobProgress(job, 'redis', 0);

      await storeJobId(jobId, contentHash);

      await updateJobProgress(job, 'redis', 100);

      return { jobId, contentHash, message: 'Successfully added embedding' };
    },
    { connection }
  );
};

const storeJobId = async (jobId: string, contentHash: string) => {
  await redisClient.set(`content:${contentHash}`, jobId);
};

// check redis for the content hash
// if it exists, return the existing hash
// if it doesn't exist, create a new hash and store it in redis
// return the new hash
export const getContentHash = async (content: string, type: string) => {
  const contentHash = createHash('sha256')
    .update(`${type}-${content}`)
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

// Helper to check and store content hash
const handleContentHash = async (job: JobBody) => {
  const contentHash = await getContentHash(job.content, job.type);
  const existingJobId = await redisClient.get(`content:${contentHash}`);

  if (existingJobId) {
    return { exists: true, jobId: existingJobId, contentHash };
  }

  return { exists: false, jobId: null, contentHash };
};

const storeEmbedding = async (embedding: number[], job: JobBody) => {
  const contentHash = await getContentHash(job.content, job.type);

  const result = await db
    .insert(embeddings)
    .values({
      id: crypto.randomUUID(),
      type: job.type,
      content: job.content,
      contentHash: contentHash,
      embedding: embedding,
      version: version,
      groups: job.groups,
      users: job.users,
    })
    .onConflictDoNothing();
};
