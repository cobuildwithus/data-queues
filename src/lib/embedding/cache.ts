import { RedisClientType } from 'redis';
import { getContentHash } from './utils';
import { JobBody } from '../../types/job';

export const EMBEDDING_CACHE_VERSION = 21;
export const contentHashPrefix = `v${EMBEDDING_CACHE_VERSION}-content:`;

// Store job ID in Redis
export const storeEmbeddingJobRun = async (
  redisClient: RedisClientType,
  jobId: string,
  contentHash: string
) => {
  await redisClient.set(`${contentHashPrefix}${contentHash}`, jobId);
};

// Check if content hash exists
export const handleContentHash = async (
  redisClient: RedisClientType,
  job: JobBody
) => {
  const contentHash = await getContentHash(
    job.content,
    job.type,
    job.hashSuffix,
    job.urls
  );
  const existingJobId = await redisClient.get(
    `${contentHashPrefix}${contentHash}`
  );

  if (existingJobId) {
    return { exists: true, jobId: existingJobId, contentHash };
  }

  return { exists: false, jobId: null, contentHash };
};

// Delete content hash from Redis
export const deleteContentHash = async (
  redisClient: RedisClientType,
  contentHash: string
) => {
  await redisClient.del(`${contentHashPrefix}${contentHash}`);
};
