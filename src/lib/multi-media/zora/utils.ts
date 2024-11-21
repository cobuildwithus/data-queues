import { Job } from 'bullmq';
import { zoraCreator1155ImplAbi } from '../../../generated';
import { retryWithExponentialBackoff } from '../../retry/retry-fetch';
import { log } from '../../helpers';
import https from 'https';
import { pinByHash } from '../pinata/pin-file';
import { baseClient } from '../../viem/client';
import { fetchFromGateway } from '../pinata/fetch-file';
import { CreatorProfile } from './creator-profile';

type TokenMetadata = {
  name: string;
  description: string;
  image: string;
  content: {
    mime: string;
    uri: string;
  };
};

/**
 * Helper function to create HTTPS agent with TLS 1.3
 */
function createHttpsAgent() {
  return new https.Agent({
    minVersion: 'TLSv1.3',
    keepAlive: true,
  });
}

export function getMediaType(mime: string) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

/**
 * Extracts contract address and token ID from a Zora URL
 */
export function parseZoraUrl(
  url: string
): { contractAddress: string; tokenId: string } | null {
  try {
    // Handle URLs with query parameters
    const urlWithoutParams = url.split('?')[0];

    // Match both with and without protocol/www
    const match = urlWithoutParams.match(
      /(?:https?:\/\/)?(?:www\.)?zora\.co\/collect\/\w+:(\w+)\/(\d+)/
    );

    if (!match) return null;
    return {
      contractAddress: match[1],
      tokenId: match[2],
    };
  } catch (error) {
    return null;
  }
}

/**
 * Gets username from profile by checking ENS, Farcaster, OpenGraph and address
 */
export function getUsername(profile?: CreatorProfile | null): string {
  if (!profile) return '';
  return (
    profile.ensName ||
    profile.farcasterProfile?.fname ||
    profile.openGraphData?.ogTitle ||
    profile.address
  );
}

export const getPopulatedDescription = (
  mediaDescription: string,
  name: string,
  description: string,
  mediaType: 'video' | 'image',
  creatorRewardsUsername: string | null,
  ownerUsername: string | null
): string => {
  const descriptionText = description
    ? ` with the description: ${description}`
    : '';

  return [
    `This is a Zora mint of the following ${mediaType}: ${mediaDescription}.`,
    `The mint is titled ${name}${descriptionText}.`,
    `The funds raised from the mint will be sent to: ${creatorRewardsUsername}.`, //todo update for splits
    `The owner of the collection that this mint belongs to is: ${ownerUsername}.`,
  ].join(' ');
};

/**
 * Fetches NFT metadata from contract
 */
export async function fetchTokenMetadata(
  contractAddress: string,
  tokenId: string,
  job: Job
): Promise<{ url: string; content: TokenMetadata } | null> {
  try {
    const uri = await baseClient.readContract({
      address: contractAddress as `0x${string}`,
      abi: zoraCreator1155ImplAbi,
      functionName: 'uri',
      args: [BigInt(tokenId)],
    });

    // Extract IPFS hash from ipfs:// URI
    const ipfsHash = uri.replace('ipfs://', '');
    return await fetchZoraContent<TokenMetadata>(ipfsHash, job);
  } catch (error: any) {
    log(`Error fetching token metadata: ${error.message}`, job);
    return null;
  }
}

export function getZoraMediaUrl(ipfsHash: string) {
  return `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${ipfsHash}`;
}

/**
 * Fetches Zora content by IPFS hash
 */
export async function fetchZoraContent<T>(
  rawHash: string,
  job: Job
): Promise<{ url: string; content: T } | null> {
  try {
    const agent = createHttpsAgent();
    // Remove ipfs:// prefix if present
    const ipfsHash = rawHash.replace('ipfs://', '');
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${ipfsHash}`;
    log(`Fetching content from ${gatewayUrl}`, job);

    try {
      // First try fetching directly from gateway
      const content = await retryWithExponentialBackoff(
        async () => fetchFromGateway<T>(gatewayUrl, agent, job),
        job,
        3,
        1000
      );
      return { url: gatewayUrl, content };
    } catch (error) {
      // If gateway fetch fails, try pinning first
      log('Gateway fetch failed, attempting to pin content first', job);

      const pinSuccess = await pinByHash(
        ipfsHash,
        `zora-content-${ipfsHash}`,
        job
      );
      if (!pinSuccess) {
        log('Failed to pin content to Pinata', job);
        return null;
      }

      // Wait 2 seconds for pinning to propagate
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try fetching again after pinning
      const content = await retryWithExponentialBackoff(
        async () => fetchFromGateway<T>(gatewayUrl, agent, job),
        job,
        3,
        1000
      );
      return { url: gatewayUrl, content };
    }
  } catch (error: any) {
    log(`Error fetching content: ${error.message}`, job);
    return null;
  }
}
