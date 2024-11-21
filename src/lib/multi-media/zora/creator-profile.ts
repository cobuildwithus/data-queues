import { Job } from 'bullmq';
import { FarcasterProfile } from '../../../database/farcaster-schema';
import { RedisClientType } from 'redis';
import { getEnsName } from '../../ens/get-ens-name';
import { getFarcasterProfileByAddress } from '../../../database/queries/profiles/get-profile';
import { log } from '../../helpers';
import { baseClient } from '../../viem/client';
import { zoraCreator1155ImplAbi } from '../../../generated';
import { getOpenGraphData, OpenGraphData } from '../../open-graph/og-data';

export interface CreatorProfile {
  farcasterProfile?: FarcasterProfile;
  ensName?: string;
  address: string;
  openGraphData: OpenGraphData | null;
}

/**
 * Helper function to get ENS name and Farcaster profile for an address
 */
async function getCreatorIdentifiers(
  address: string,
  redisClient: RedisClientType,
  job: Job
): Promise<{
  ensName?: string;
  farcasterProfile?: FarcasterProfile;
  openGraphData: OpenGraphData | null;
}> {
  const [ensName, farcasterProfile, openGraphData] = await Promise.all([
    getEnsName(address, redisClient),
    getFarcasterProfileByAddress(address, redisClient),
    getOpenGraphData(`https://zora.co/${address}`, job),
  ]);

  return {
    ensName: ensName || undefined,
    farcasterProfile,
    openGraphData,
  };
}

/**
 * Gets creator profile info from a Zora contract and token ID
 */
export async function getZoraCreatorRewardRecipientProfile(
  contractAddress: string,
  tokenId: string,
  job: Job,
  redisClient: RedisClientType
): Promise<CreatorProfile | null> {
  try {
    // Get creator address from contract
    const creatorAddress = await baseClient.readContract({
      address: contractAddress as `0x${string}`,
      abi: zoraCreator1155ImplAbi,
      functionName: 'getCreatorRewardRecipient',
      args: [BigInt(tokenId)],
    });

    // Get ENS name and Farcaster profile
    const { ensName, farcasterProfile, openGraphData } =
      await getCreatorIdentifiers(creatorAddress, redisClient, job);

    return {
      farcasterProfile,
      ensName,
      address: creatorAddress,
      openGraphData,
    };
  } catch (error: any) {
    log(`Error getting creator profile: ${error.message}`, job);
    return null;
  }
}

/**
 * Gets owner profile info from a Zora contract and token ID
 */
export async function getZoraOwnerProfile(
  contractAddress: string,
  job: Job,
  redisClient: RedisClientType
): Promise<CreatorProfile | null> {
  try {
    // Get owner address from contract
    const ownerAddress = await baseClient.readContract({
      address: contractAddress as `0x${string}`,
      abi: zoraCreator1155ImplAbi,
      functionName: 'owner',
      args: [],
    });

    // Get ENS name and Farcaster profile
    const { ensName, farcasterProfile, openGraphData } =
      await getCreatorIdentifiers(ownerAddress, redisClient, job);

    return {
      farcasterProfile,
      ensName,
      address: ownerAddress,
      openGraphData,
    };
  } catch (error: any) {
    log(`Error getting owner profile: ${error.message}`, job);
    return null;
  }
}
