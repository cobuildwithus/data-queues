import { Worker, Job, RedisOptions, ClusterOptions, Queue } from 'bullmq';
import { BuilderProfileJobBody, JobBody } from '../types/job';
import { log } from '../lib/queueLib';
import { RedisClientType } from 'redis';
import { generateBuilderProfile } from '../lib/builders/analyze-builder';
import { getAllCastsWithParents } from '../database/queries';
import { FarcasterCast } from '../database/farcaster-schema';

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
          const casts = await getAllCastsWithParents(Number(profile.fid));

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

          embeddingJobs.push({
            type: 'builder-profile',
            content: cleanTextForEmbedding(analysis),
            rawContent: analysis,
            externalId: profile.fid.toString(),
            groups: getUniqueRootParentUrls(casts),
            users: [profile.fid.toString()],
            tags: [],
          });
        }

        const queueJobName = `embed-builder-profile-${Date.now()}`;

        const queueJob = await bulkEmbeddingsQueue.add(
          queueJobName,
          embeddingJobs
        );

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
      concurrency: 5, // Lower concurrency since this involves heavy AI analysis
      lockDuration: 1200000, // 20 minutes
      lockRenewTime: 600000, // 10 minutes (half of lockDuration)
    }
  );
};

const getUniqueRootParentUrls = (casts: FarcasterCast[]): string[] => {
  return [
    ...new Set(
      casts
        .filter(
          (cast) => cast.parentHash === null && cast.rootParentUrl !== null
        )
        .map((cast) => cast.rootParentUrl!)
    ),
  ];
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
