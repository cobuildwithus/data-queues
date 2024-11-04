import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { env } from './env';
import { JobBody } from './types/job';
import { createClient } from 'redis';

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
      console.log(job.data);
      const jobId = job.id;
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const data = job.data as JobBody;
      const contentHash = await getContentHash(data.content);

      // Check if content already processed
      const existingHash = await redisClient.get(`content:${contentHash}`);
      if (existingHash) {
        await job.log('Content already processed, skipping...');
        return { jobId: existingHash };
      }

      // Process the job
      for (let i = 0; i <= 100; i++) {
        await job.updateProgress(i);
        await job.log(`Processing job at interval ${i}`);
      }

      // Store the processed content hash
      await redisClient.set(`content:${contentHash}`, jobId);

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
