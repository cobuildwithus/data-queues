import { Job } from 'bullmq';
import { RedisClientType } from 'redis';
import { log } from '../../helpers';
import { describeImage } from '../image/describe-image';
import { describeVideo } from '../video/describe-video';
import {
  fetchTokenMetadata,
  fetchZoraContent,
  getMediaType,
  getPopulatedDescription,
  getUsername,
  getZoraMediaUrl,
  parseZoraUrl,
} from './utils';
import {
  CreatorProfile,
  getZoraCreatorRewardRecipientProfile,
  getZoraOwnerProfile,
} from './creator-profile';
import { storeZoraContent } from './store';
import { getZoraMetadata } from './get-metadata';

/**
 * Describes Zora NFT content by analyzing its media
 */
export async function describeZora(
  zoraUrl: string,
  redisClient: RedisClientType,
  job: Job
): Promise<string | null> {
  try {
    // Parse Zora URL
    const parsed = parseZoraUrl(zoraUrl);
    if (!parsed) {
      log(`Invalid Zora URL format: ${zoraUrl}`, job);
      return null;
    }

    const { contractAddress, tokenId } = parsed;

    const cachedMetadata = await getZoraMetadata(contractAddress, tokenId);

    if (cachedMetadata && cachedMetadata.contentAiDescription) {
      log('Found cached Zora metadata', job);

      const mediaType = getMediaType(cachedMetadata.contentMime);

      if (!mediaType) {
        log('No media type found in cached Zora metadata', job);
        return null;
      }

      return getPopulatedDescription(
        cachedMetadata.contentAiDescription,
        cachedMetadata.name,
        cachedMetadata.description,
        mediaType,
        cachedMetadata.creatorRewardsRecipientUsername,
        cachedMetadata.ownerUsername
      );
    }

    // Fetch metadata
    const metadata = await fetchTokenMetadata(contractAddress, tokenId, job);
    if (!metadata?.content) {
      log('No token metadata found', job);
      throw new Error(`No token metadata found for Zora url: ${zoraUrl}`);
    }

    const { content } = metadata;

    console.log('Content', content);

    log(`Token metadata: ${JSON.stringify(metadata, null, 2)}`, job);

    const mediaUrl = getZoraMediaUrl(
      content.content.uri.replace('ipfs://', '')
    );

    const [creatorRewardsProfile, ownerProfile] = await Promise.all([
      getZoraCreatorRewardRecipientProfile(
        contractAddress,
        tokenId,
        job,
        redisClient
      ),
      getZoraOwnerProfile(contractAddress, job, redisClient),
    ]);

    if (!mediaUrl) {
      log('No media URL found in token metadata', job);
      return null;
    }

    // Determine media type and describe accordingly
    const mimeType = content.content.mime || '';

    if (getMediaType(mimeType) === 'video') {
      return describeAndStore(
        mediaUrl,
        'video',
        zoraUrl,
        contractAddress,
        tokenId,
        metadata,
        creatorRewardsProfile,
        ownerProfile,
        redisClient,
        job
      );
    } else if (getMediaType(mimeType) === 'image') {
      return describeAndStore(
        mediaUrl,
        'image',
        zoraUrl,
        contractAddress,
        tokenId,
        metadata,
        creatorRewardsProfile,
        ownerProfile,
        redisClient,
        job
      );
    } else {
      log(`Unsupported media type: ${mimeType}`, job);
      return null;
    }
  } catch (error: any) {
    log(`Error describing Zora NFT: ${error.message}`, job);
    return null;
  }
}

async function describeAndStore(
  mediaUrl: string,
  mediaType: 'video' | 'image',
  zoraUrl: string,
  contractAddress: string,
  tokenId: string,
  metadata: any,
  creatorRewardsProfile: CreatorProfile | null,
  ownerProfile: CreatorProfile | null,
  redisClient: RedisClientType,
  job: Job
) {
  const description = await (mediaType === 'video'
    ? describeVideo(mediaUrl, redisClient, job)
    : describeImage(mediaUrl, redisClient, job));

  if (!description) return null;

  const numUpdatedRows = await storeZoraContent(
    zoraUrl,
    contractAddress,
    tokenId,
    metadata,
    description,
    creatorRewardsProfile,
    ownerProfile
  );

  if (numUpdatedRows === 0) {
    log('No rows updated', job);
    return null;
  }

  log(`Saved Zora mint to database: ${numUpdatedRows} rows`, job);

  return getPopulatedDescription(
    description,
    metadata.name,
    metadata.description,
    mediaType,
    getUsername(creatorRewardsProfile),
    getUsername(ownerProfile)
  );
}
