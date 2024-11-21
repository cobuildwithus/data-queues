import { farcasterCasts, farcasterProfiles } from '../../farcaster-schema';
import { farcasterDb } from '../../farcasterDb';
import { eq, sql } from 'drizzle-orm';

export const getCast = async (castHash: string) => {
  // Convert the hexadecimal hash string to a Buffer
  const castHashBuffer = Buffer.from(castHash.replace(/^0x/, ''), 'hex');

  const cast = await farcasterDb
    .select({
      id: farcasterCasts.id,
      createdAt: farcasterCasts.createdAt,
      timestamp: farcasterCasts.timestamp,
      fid: farcasterCasts.fid,
      hash: farcasterCasts.hash,
      embeds: farcasterCasts.embeds,
      embedSummaries: farcasterCasts.embedSummaries,
      text: farcasterCasts.text,
      computedTags: farcasterCasts.computedTags,
      storyIds: farcasterCasts.storyIds,
      profile: {
        fid: farcasterProfiles.fid,
        fname: farcasterProfiles.fname,
      },
    })
    .from(farcasterCasts)
    .leftJoin(farcasterProfiles, eq(farcasterCasts.fid, farcasterProfiles.fid))
    .where(sql`hash = ${castHashBuffer}`);

  return cast[0];
};

export type Cast = Awaited<ReturnType<typeof getCast>>;
