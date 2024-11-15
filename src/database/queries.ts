import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { farcasterCasts, farcasterProfiles } from './farcaster-schema';
import { farcasterDb } from './farcasterDb';
import { alias } from 'drizzle-orm/pg-core';

export const getAllCastsWithParents = async (fid: number) => {
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
      embedSummaries: farcasterCasts.embedSummaries,
      parentCast: {
        text: parentCastsAlias.text,
        fname: profilesAlias.fname,
        embedSummaries: parentCastsAlias.embedSummaries,
        embeds: parentCastsAlias.embeds,
        fid: parentCastsAlias.fid,
        id: parentCastsAlias.id,
      },
    })
    .from(farcasterCasts)
    .leftJoin(
      parentCastsAlias,
      eq(farcasterCasts.parentHash, parentCastsAlias.hash)
    )
    .leftJoin(profilesAlias, eq(parentCastsAlias.fid, profilesAlias.fid))
    .where(eq(farcasterCasts.fid, fid))
    //   and(
    //     eq(farcasterCasts.fid, fid),
    //     sql`farcaster_casts.hash = ${Buffer.from(
    //       '5f766833c078a6a05979cedae518b05fd597ed0f',
    //       'hex'
    //     )}`
    //   )
    // )
    .orderBy(asc(farcasterCasts.timestamp));

  return casts;
};

export type CastWithParent = Awaited<
  ReturnType<typeof getAllCastsWithParents>
>[number];
