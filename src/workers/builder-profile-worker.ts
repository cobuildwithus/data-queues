import { Worker, Job, RedisOptions, ClusterOptions } from 'bullmq';
import { BuilderProfileJobBody } from '../types/job';
import { log } from '../lib/queueLib';
import { RedisClientType } from 'redis';
import {
  farcasterCasts,
  farcasterProfiles,
} from '../database/farcaster-schema';
import { farcasterDb } from '../database/farcasterDb';
import { desc, eq } from 'drizzle-orm';
import { generateBuilderProfile } from '../lib/builders/analyze-builder';
import { alias } from 'drizzle-orm/pg-core';

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

const getAllCastsWithParents = async (fid: number) => {
  const parentCastsAlias = alias(farcasterCasts, 'parentCasts');
  const profilesAlias = alias(farcasterProfiles, 'profiles');

  const casts = await farcasterDb
    .select({
      id: farcasterCasts.id,
      createdAt: farcasterCasts.createdAt,
      updatedAt: farcasterCasts.updatedAt,
      deletedAt: farcasterCasts.deletedAt,
      timestamp: farcasterCasts.timestamp,
      fid: farcasterCasts.fid,
      hash: farcasterCasts.hash,
      parentHash: farcasterCasts.parentHash,
      parentFid: farcasterCasts.parentFid,
      parentUrl: farcasterCasts.parentUrl,
      text: farcasterCasts.text,
      embeds: farcasterCasts.embeds,
      mentions: farcasterCasts.mentions,
      mentionsPositions: farcasterCasts.mentionsPositions,
      rootParentHash: farcasterCasts.rootParentHash,
      rootParentUrl: farcasterCasts.rootParentUrl,
      computedTags: farcasterCasts.computedTags,
      parentCast: {
        text: parentCastsAlias.text,
        parentFname: profilesAlias.fname,
      },
    })
    .from(farcasterCasts)
    .leftJoin(
      parentCastsAlias,
      eq(farcasterCasts.parentHash, parentCastsAlias.hash)
    )
    .leftJoin(profilesAlias, eq(parentCastsAlias.fid, profilesAlias.fid))
    .where(eq(farcasterCasts.fid, fid))
    .orderBy(desc(farcasterCasts.timestamp));

  return casts;
};

export type CastWithParent = Awaited<
  ReturnType<typeof getAllCastsWithParents>
>[number];
