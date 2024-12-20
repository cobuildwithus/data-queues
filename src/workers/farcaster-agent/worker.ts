import { Worker, Job, RedisOptions, ClusterOptions, Queue } from 'bullmq';
import { FarcasterAgentJobBody, StoryJobBody } from '../../types/job';
import { RedisClientType } from 'redis';

export const farcasterAgentWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType
) => {
  new Worker<FarcasterAgentJobBody>(
    queueName,
    async (job: Job<FarcasterAgentJobBody>) => {
      const jobData = job.data;

      try {
      } catch (error) {
        console.error('Error processing casts:', error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 25, // Lower concurrency since this involves AI analysis
      lockDuration: 600000, // 10 minutes
      lockRenewTime: 300000, // 5 minutes (half of lockDuration)
    }
  );
};
