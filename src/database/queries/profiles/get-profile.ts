import { RedisClientType } from 'redis';
import { farcasterProfiles } from '../../farcaster-schema';
import { farcasterDb } from '../../farcasterDb';
import { eq, arrayContains } from 'drizzle-orm';

export const getFarcasterProfile = async (fid: number) => {
  const profile = await farcasterDb
    .select()
    .from(farcasterProfiles)
    .where(eq(farcasterProfiles.fid, fid));
  return profile[0];
};

export const getFarcasterProfileByAddress = async (
  address: string,
  redisClient: RedisClientType
) => {
  // Check cache first
  const cacheKey = `farcaster-profile-by-address:${address}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Query database if not in cache
  const profile = await farcasterDb
    .select()
    .from(farcasterProfiles)
    .where(arrayContains(farcasterProfiles.verifiedAddresses, [address]));

  const result = profile[0];

  // Cache result for 1 hour if found
  if (result) {
    await redisClient.set(cacheKey, JSON.stringify(result), {
      EX: 60 * 60 * 24, // 24 hour TTL
    });
  }

  return result;
};
