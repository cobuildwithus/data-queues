import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { FarcasterAgentJobBody } from '../../types/job';
import { RedisClientType } from 'redis';
import { getAgentResponse } from '../../lib/farcaster-agent/analysis/get-response';
import { publishFarcasterCast } from '../../lib/neynar/publish-cast';

const signerUuid = process.env.DR_GONZO_FARCASTER_SIGNER_KEY;

if (!signerUuid) {
  throw new Error('DR_GONZO_FARCASTER_SIGNER_KEY is not set');
}

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
        const response = await getAgentResponse(redisClient, jobData, job);

        await publishFarcasterCast(
          signerUuid,
          jobData.agentFid,
          response,
          jobData
        );
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
