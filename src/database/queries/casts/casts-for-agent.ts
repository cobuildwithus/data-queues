import { asc, eq } from 'drizzle-orm';
import { farcasterCasts, farcasterProfiles } from '../../farcaster-schema';
import { farcasterDb } from '../../farcasterDb';
import { alias } from 'drizzle-orm/pg-core';
import { getFarcasterProfilesByFids } from '../profiles/get-profile';
import {
  getGrantsByAddresses,
  GrantWithParent,
} from '../grants/get-grant-by-addresses';

export interface CastWithParentAndReplies {
  id: number;
  createdAt: Date | null;
  timestamp: Date | null;
  fid: number | null;
  hash: Buffer | null;
  parentHash: string | null;
  text: string | null;
  embeds: string | null;
  embedSummaries: string[] | null;
  rootParentHash: string | null;
  mentionsPositionsArray: number[] | null;
  mentionedFids: number[] | null;
  authorGrants: GrantWithParent[] | null;
  mentionedFnames: string[] | null;
  profile: {
    fid: number;
    fname: string | null;
  } | null;
  parentCast: {
    id: number | null;
    text: string | null;
    fid: number | null;
    fname: string | null;
    embeds: string | null;
    authorGrants: GrantWithParent[] | null;
    embedSummaries: string[] | null;
    mentionsPositionsArray: number[] | null;
    mentionedFids: number[] | null;
    mentionedFnames: string[] | null;
  } | null;
  rootCast: {
    id: number | null;
    text: string | null;
    fid: number | null;
    fname: string | null;
    authorGrants: GrantWithParent[] | null;
    embeds: string | null;
    embedSummaries: string[] | null;
    timestamp: Date | null;
    mentionsPositionsArray: number[] | null;
    mentionedFids: number[] | null;
    mentionedFnames: string[] | null;
  } | null;
  otherReplies: {
    id: number | null;
    text: string | null;
    fid: number | null;
    authorGrants: GrantWithParent[] | null;
    fname: string | null;
    embeds: string | null;
    embedSummaries: string[] | null;
    timestamp: Date | null;
    mentionsPositionsArray: number[] | null;
    mentionedFids: number[] | null;
    mentionedFnames: string[] | null;
  }[];
}

export async function getCastsForAgent(
  castId: number
): Promise<CastWithParentAndReplies | null> {
  const parentCastsAlias = alias(farcasterCasts, 'parentCasts');
  const parentProfileAlias = alias(farcasterProfiles, 'parentProfiles');
  const otherRepliesAlias = alias(farcasterCasts, 'otherReplies');
  const otherRepliesProfilesAlias = alias(
    farcasterProfiles,
    'otherRepliesProfiles'
  );
  const rootCastsAlias = alias(farcasterCasts, 'rootCasts');
  const rootProfilesAlias = alias(farcasterProfiles, 'rootProfiles');

  const result = await farcasterDb
    .select({
      id: farcasterCasts.id,
      createdAt: farcasterCasts.createdAt,
      timestamp: farcasterCasts.timestamp,
      fid: farcasterCasts.fid,
      hash: farcasterCasts.hash,
      parentHash: farcasterCasts.parentHash,
      text: farcasterCasts.text,
      embeds: farcasterCasts.embeds,
      embedSummaries: farcasterCasts.embedSummaries,
      rootParentHash: farcasterCasts.rootParentHash,
      mentionsPositionsArray: farcasterCasts.mentionsPositionsArray,
      mentionedFids: farcasterCasts.mentionedFids,
      profile: {
        fid: farcasterProfiles.fid,
        fname: farcasterProfiles.fname,
      },
      parentCast: {
        id: parentCastsAlias.id,
        text: parentCastsAlias.text,
        fid: parentCastsAlias.fid,
        fname: parentProfileAlias.fname,
        embeds: parentCastsAlias.embeds,
        embedSummaries: parentCastsAlias.embedSummaries,
        mentionsPositionsArray: parentCastsAlias.mentionsPositionsArray,
        mentionedFids: parentCastsAlias.mentionedFids,
      },
      rootCast: {
        id: rootCastsAlias.id,
        text: rootCastsAlias.text,
        fid: rootCastsAlias.fid,
        fname: rootProfilesAlias.fname,
        embeds: rootCastsAlias.embeds,
        embedSummaries: rootCastsAlias.embedSummaries,
        timestamp: rootCastsAlias.timestamp,
        mentionsPositionsArray: rootCastsAlias.mentionsPositionsArray,
        mentionedFids: rootCastsAlias.mentionedFids,
      },
      otherReplies: {
        id: otherRepliesAlias.id,
        text: otherRepliesAlias.text,
        fid: otherRepliesAlias.fid,
        fname: otherRepliesProfilesAlias.fname,
        embeds: otherRepliesAlias.embeds,
        embedSummaries: otherRepliesAlias.embedSummaries,
        timestamp: otherRepliesAlias.timestamp,
        mentionsPositionsArray: otherRepliesAlias.mentionsPositionsArray,
        mentionedFids: otherRepliesAlias.mentionedFids,
      },
    })
    .from(farcasterCasts)
    .leftJoin(farcasterProfiles, eq(farcasterCasts.fid, farcasterProfiles.fid))
    .leftJoin(
      parentCastsAlias,
      eq(farcasterCasts.parentHash, parentCastsAlias.hash)
    )
    .leftJoin(
      parentProfileAlias,
      eq(parentCastsAlias.fid, parentProfileAlias.fid)
    )
    .leftJoin(
      rootCastsAlias,
      eq(farcasterCasts.rootParentHash, rootCastsAlias.hash)
    )
    .leftJoin(rootProfilesAlias, eq(rootCastsAlias.fid, rootProfilesAlias.fid))
    .leftJoin(
      otherRepliesAlias,
      eq(farcasterCasts.rootParentHash, otherRepliesAlias.rootParentHash)
    )
    .leftJoin(
      otherRepliesProfilesAlias,
      eq(otherRepliesAlias.fid, otherRepliesProfilesAlias.fid)
    )
    .where(eq(farcasterCasts.id, castId))
    .orderBy(asc(otherRepliesAlias.timestamp));

  if (!result.length) return null;

  // Restructure the result to match the interface
  const mainCast = result[0];
  const otherReplies = result
    .filter((r) => r.otherReplies.id !== mainCast.id) // Exclude the main cast from other replies
    .map((r) => r.otherReplies)
    .filter(
      (cast, index, self) => index === self.findIndex((c) => c.id === cast.id)
    );

  // Get mentioned fnames for all casts
  const allMentionedFids = [
    ...(mainCast.mentionedFids || []),
    ...(mainCast.parentCast?.mentionedFids || []),
    ...(mainCast.rootCast?.mentionedFids || []),
    ...otherReplies.flatMap((reply) => reply.mentionedFids || []),
  ];

  const uniqueMentionedFids = Array.from(new Set(allMentionedFids)).filter(
    (fid) => typeof fid === 'number'
  );
  const mentionedProfiles = uniqueMentionedFids.length
    ? await getFarcasterProfilesByFids(uniqueMentionedFids)
    : [];

  // Get verified addresses from mentioned profiles to check for grants
  const verifiedAddresses = mentionedProfiles
    .flatMap((profile) => profile.verifiedAddresses || [])
    .filter(Boolean);

  const relevantGrants = await getGrantsByAddresses(verifiedAddresses);

  const getFnamesForFids = (fids: number[] | null) => {
    if (!fids) return null;
    return fids.map((fid) => {
      const profile = mentionedProfiles.find((p) => p.fid === fid);
      return profile?.fname ?? fid.toString();
    });
  };

  // fid to verified address
  const fidToVerifiedAddress = mentionedProfiles.reduce(
    (acc, profile) => {
      if (profile.verifiedAddresses) {
        acc[profile.fid] = profile.verifiedAddresses;
      }
      return acc;
    },
    {} as Record<number, string[]>
  );

  return {
    ...mainCast,
    authorGrants: relevantGrants.filter(
      (grant) =>
        grant.recipient === fidToVerifiedAddress[mainCast.fid ?? 0]?.[0]
    ),
    mentionedFnames: getFnamesForFids(mainCast.mentionedFids),
    parentCast:
      mainCast.parentCast.id && mainCast.parentCast.fid !== null
        ? {
            ...mainCast.parentCast,
            mentionedFnames: getFnamesForFids(
              mainCast.parentCast.mentionedFids
            ),
            authorGrants: relevantGrants.filter(
              (grant) =>
                grant.recipient ===
                fidToVerifiedAddress[mainCast.parentCast.fid ?? 0]?.[0]
            ),
          }
        : null,
    rootCast:
      mainCast.rootCast.id && mainCast.rootCast.id !== mainCast.id
        ? {
            ...mainCast.rootCast,
            mentionedFnames: getFnamesForFids(mainCast.rootCast.mentionedFids),
            authorGrants: relevantGrants.filter(
              (grant) =>
                grant.recipient ===
                fidToVerifiedAddress[mainCast.rootCast.fid ?? 0]?.[0]
            ),
          }
        : null,
    otherReplies: otherReplies
      .filter((reply) => reply.id !== mainCast.rootCast.id)
      .map((reply) => ({
        ...reply,
        mentionedFnames: getFnamesForFids(reply.mentionedFids),
        authorGrants: relevantGrants.filter(
          (grant) =>
            grant.recipient === fidToVerifiedAddress[reply.fid ?? 0]?.[0]
        ),
      })),
  };
}

export type CastForAgent = Awaited<ReturnType<typeof getCastsForAgent>>;
