import { Worker, Job, RedisOptions, ClusterOptions, Queue } from 'bullmq';
import { BuilderProfileJobBody, JobBody } from '../../types/job';
import { log } from '../../lib/helpers';
import { RedisClientType } from 'redis';
import { generateBuilderProfile } from '../../lib/builders/analyze-builder';
import { getAllCastsWithParents } from '../../database/queries/casts/casts-with-parent';
import { getFarcasterProfile } from '../../database/queries/profiles/get-profile';
import { getUniqueRootParentUrls } from './utils';
import { cleanTextForEmbedding } from '../../lib/embedding/utils';

const BUILDER_LOCK_PREFIX = 'builder-profile-locked-v2:';
const LOCK_TTL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

interface LockData {
  timestamp: number;
  ttl: number;
}

export const builderProfileWorker = async (
  queueName: string,
  connection: RedisOptions | ClusterOptions,
  redisClient: RedisClientType,
  bulkEmbeddingsQueue: Queue<JobBody[]>
) => {
  new Worker<BuilderProfileJobBody[]>(
    queueName,
    async (job: Job<BuilderProfileJobBody[]>) => {
      const builderProfiles = job.data;
      const embeddingJobs: JobBody[] = [];

      if (!builderProfiles || !builderProfiles.length) {
        throw new Error('Builder profile data is required');
      }

      try {
        const results = [];
        for (const profile of builderProfiles) {
          // Check if this builder is already being processed
          const lockKey = `${BUILDER_LOCK_PREFIX}${profile.fid}`;
          // Attempt to acquire the lock
          const lockAcquired = await redisClient.set(lockKey, 'locked', {
            NX: true,
            PX: LOCK_TTL,
          });

          if (!lockAcquired) {
            log(
              `Builder ${profile.fid} is already being processed or was recently processed, skipping`,
              job
            );
            continue; // Skip to the next profile
          }

          try {
            const casts = await getAllCastsWithParents(Number(profile.fid));
            const farcasterProfile = await getFarcasterProfile(
              Number(profile.fid)
            );

            if (!farcasterProfile) {
              throw new Error(
                `Farcaster profile not found for FID: ${profile.fid}`
              );
            }

            if (!casts.length) {
              log(`No casts found for FID: ${profile.fid}, skipping`, job);
              continue;
            }

            log(`Analyzing ${casts.length} casts for FID: ${profile.fid}`, job);

            // Generate builder profile analysis
            const analysis = await generateBuilderProfile(
              casts,
              redisClient,
              job
            );

            if (!analysis) {
              throw new Error(`No analysis found for FID: ${profile.fid}`);
            }

            log(`Generated builder profile for FID: ${profile.fid}`, job);

            results.push({
              fid: profile.fid,
              analysis,
            });

            const groups = getUniqueRootParentUrls(casts);

            embeddingJobs.push({
              type: 'builder-profile',
              content: cleanTextForEmbedding(analysis),
              rawContent: analysis,
              externalId: profile.fid.toString(),
              groups,
              users: [profile.fid.toString()],
              externalUrl: `https://warpcast.com/${farcasterProfile.fname}`,
              tags: [],
            });

            log(`Added builder profile to embedding queue`, job);
            await redisClient.del(lockKey);
          } catch (error) {
            // Clear lock if profile not found
            await redisClient.del(lockKey);
            throw error;
          }
        }

        const queueJobName = `embed-builder-profile-${Date.now()}`;

        const queueJob = await bulkEmbeddingsQueue.add(
          queueJobName,
          embeddingJobs
        );

        log(`Added ${embeddingJobs.length} embedding jobs to queue`, job);

        return {
          jobId: job.id,
          results,
          queueJobId: queueJob.id,
        };
      } catch (error) {
        console.error('Error generating builder profiles:', error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 40, // Lower concurrency since this involves heavy AI analysis
      lockDuration: 1200000, // 20 minutes
      lockRenewTime: 600000, // 10 minutes (half of lockDuration)
    }
  );
};
