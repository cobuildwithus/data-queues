import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { BuilderProfileJobBody } from '../types/job';
import { log } from '../lib/queueLib';
import { RedisClientType } from 'redis';
import { generateBuilderProfile } from '../lib/builders/analyze-builder';
import { getAllCastsWithParents } from '../database/queries';

export const builderProfileWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType
) => {
  new Worker<BuilderProfileJobBody[]>(
    queueName,
    async (job: Job<BuilderProfileJobBody[]>) => {
      const builderProfiles = job.data;

      if (!builderProfiles || !builderProfiles.length) {
        throw new Error('Builder profile data is required');
      }

      try {
        const results = [];
        for (const profile of builderProfiles) {
          const casts = await getAllCastsWithParents(Number(profile.fid));

          // Generate builder profile analysis
          const analysis = await generateBuilderProfile(
            casts,
            redisClient,
            job
          );

          console.log({ analysis });

          log(`Generated builder profile for FID: ${profile.fid}`, job);

          results.push({
            fid: profile.fid,
            analysis,
          });
        }

        return {
          jobId: job.id,
          results,
        };
      } catch (error) {
        console.error('Error generating builder profiles:', error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 5, // Lower concurrency since this involves heavy AI analysis
      lockDuration: 1200000, // 20 minutes
      lockRenewTime: 600000, // 10 minutes (half of lockDuration)
    }
  );
};
