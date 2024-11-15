import { Worker, Job, RedisOptions, ClusterOptions, Queue } from 'bullmq';
import { BuilderProfileJobBody, JobBody } from '../types/job';
import { log } from '../lib/queueLib';
import { RedisClientType } from 'redis';
import { generateBuilderProfile } from '../lib/builders/analyze-builder';
import {
  getAllCastsWithParents,
  getFarcasterProfile,
} from '../database/queries';
import { FarcasterCast } from '../database/farcaster-schema';
import { cacheResult, getCachedResult } from '../lib/cache/cacheResult';
import { safeTrim } from '../lib/builders/utils';

const BUILDER_LOCK_PREFIX = 'builder-profile-locked:';

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
          const existingLock = await getCachedResult<string>(
            redisClient,
            lockKey,
            ''
          );

          if (existingLock) {
            log(
              `Builder ${profile.fid} is already being processed, skipping`,
              job
            );
            continue;
          }

          try {
            // Set lock before processing
            await cacheResult(
              redisClient,
              lockKey,
              '',
              async () => 'locked',
              true
            );

            const casts = await getAllCastsWithParents(Number(profile.fid));
            const farcasterProfile = await getFarcasterProfile(
              Number(profile.fid)
            );

            if (!farcasterProfile) {
              // Clear lock if profile not found
              await redisClient.del(lockKey);
              throw new Error(
                `Farcaster profile not found for FID: ${profile.fid}`
              );
            }

            log(`Analyzing ${casts.length} casts for FID: ${profile.fid}`, job);

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
            // Clear lock if anything fails
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
      concurrency: 10, // Lower concurrency since this involves heavy AI analysis
      lockDuration: 1200000, // 20 minutes
      lockRenewTime: 600000, // 10 minutes (half of lockDuration)
    }
  );
};

const getUniqueRootParentUrls = (casts: FarcasterCast[]): string[] => {
  return Array.from(
    new Set(
      casts
        .filter(
          (cast) => cast.parentHash === null && cast.rootParentUrl !== null
        )
        .map((cast) => cast.rootParentUrl)
        .filter(
          (url): url is string =>
            url !== undefined &&
            url !== null &&
            safeTrim(url) !== '' &&
            safeTrim(url) !== '""'
        )
    )
  );
};

const cleanTextForEmbedding = (text: string) => {
  return (
    text
      // Remove actual newline and carriage return characters
      .replace(/(\r\n|\n|\r)/g, ' ')
      // Replace escaped newline and carriage return sequences with a space
      .replace(/\\n|\\r/g, ' ')
      // Remove markdown images
      .replace(/!\[[^\]]*\]\([^\)]*\)/g, '')
      // Remove markdown headings
      .replace(/^#+\s/gm, '')
      // Remove markdown list markers (- or *)
      .replace(/^[-*]\s/gm, '')
      // Remove HTML tags if any
      .replace(/<[^>]+>/g, ' ')
      // Normalize multiple spaces to a single space
      .replace(/\s+/g, ' ')
      // Remove unnecessary characters like # and *
      .replace(/[#*]/g, ' ')
      // Trim leading and trailing whitespace
      .trim()
      // Convert to lowercase
      .toLowerCase()
  );
};
