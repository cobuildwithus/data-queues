import { ConnectionOptions, Queue } from 'bullmq';
import { JobBody } from './types/job';
import { createClient } from 'redis';
import OpenAI from 'openai';
import { deletionQueueWorker } from './workers/delete-embed';
import { bulkEmbeddingsWorker } from './workers/bulk-embeddings';
import { singleEmbeddingWorker } from './workers/single-embedding';

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

export type RedisClient = typeof redisClient;

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

  singleEmbeddingWorker<T>(queueName, connection, redisClient, openai);
};

export const setupBulkQueueProcessor = async <T = JobBody>(
  queueName: string
) => {
  await ensureRedisConnected();

  bulkEmbeddingsWorker<T>(queueName, connection, redisClient, openai);
};

export const setupDeletionQueueProcessor = async (queueName: string) => {
  await ensureRedisConnected();

  deletionQueueWorker(queueName, connection, redisClient);
};
