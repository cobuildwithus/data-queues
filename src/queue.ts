import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { env } from './env';
import { JobBody } from './types/job';
import { createClient } from 'redis';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

const connection: ConnectionOptions = {
  host: env.REDISHOST,
  port: env.REDISPORT,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
};

const redisClient = createClient({
  url: `redis://${env.REDISHOST}:${env.REDISPORT}`,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
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

      const data = job.data as JobBody;
      const { exists, hash } = await handleContentHash(data.content, jobId);

      if (exists) {
        log('Content already processed, skipping...', job);
        return { jobId: hash };
      }

      await updateJobProgress(job, 'embeddings', 0);

      // Get embeddings for the content
      const embedding = await getEmbedding(data.content);
      log(`Generated embedding with ${embedding.length} dimensions`, job);

      await updateJobProgress(job, 'embeddings', 100);
      await updateJobProgress(job, 'processing', 0);

      return { jobId: `This is the return value of job (${jobId})` };
    },
    { connection }
  );
};

// check redis for the content hash
// if it exists, return the existing hash
// if it doesn't exist, create a new hash and store it in redis
// return the new hash
export const getContentHash = async (content: string) => {
  const contentHash = createHash('sha256').update(content).digest('hex');
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
const handleContentHash = async (content: string, jobId: string) => {
  const contentHash = await getContentHash(content);
  const existingHash = await redisClient.get(`content:${contentHash}`);

  if (existingHash) {
    return { exists: true, hash: existingHash };
  }

  await redisClient.set(`content:${contentHash}`, jobId);
  return { exists: false, hash: contentHash };
};
