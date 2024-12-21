import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { FarcasterAgentJobBody } from '../../types/job';
import { RedisClientType } from 'redis';
import { getAgentResponse } from '../../lib/farcaster-agent/analysis/get-response';

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
        console.log({ jobData });
        const response = await getAgentResponse(redisClient, jobData, job);
        console.log({ response });
      } catch (error) {
        console.error('Error processing agent request:', error);
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
