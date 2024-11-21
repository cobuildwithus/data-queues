import { farcasterDb } from '../../../database/farcasterDb';
import { tokenMetadata } from '../../../database/token-metadata-schema';
import { sql } from 'drizzle-orm';
import { CreatorProfile } from './creator-profile';
import { getUsername } from './utils';

/**
 * Stores Zora NFT metadata in the database
 */
export async function storeZoraContent(
  url: string,
  contractAddress: string,
  tokenId: string,
  metadata: {
    content: {
      name: string;
      description: string;
      image: string;
      content: {
        mime: string;
        uri: string;
      };
    };
  },
  contentAiDescription: string | null,
  creatorRewardsRecipient: CreatorProfile | null,
  owner: CreatorProfile | null
) {
  return await storeZoraMetadata({
    contractAddress,
    tokenId,
    url,
    name: metadata.content.name,
    description: metadata.content.description,
    image: metadata.content.image,
    animationUrl: metadata.content.content.uri,
    contentMime: metadata.content.content.mime,
    contentUri: metadata.content.content.uri,
    contentAiDescription,
    creatorRewardsRecipient: creatorRewardsRecipient?.address,
    owner: owner?.address,
    ownerUsername: getUsername(owner),
    creatorRewardsRecipientUsername: getUsername(creatorRewardsRecipient),
  });
}

async function storeZoraMetadata({
  contractAddress,
  tokenId,
  url,
  name,
  description,
  image,
  animationUrl,
  contentMime,
  contentUri,
  contentAiDescription,
  creatorRewardsRecipient,
  owner,
  ownerUsername,
  creatorRewardsRecipientUsername,
}: {
  contractAddress: string;
  tokenId: string;
  url: string;
  name: string;
  description: string;
  image: string;
  animationUrl: string;
  contentMime: string;
  contentUri: string;
  contentAiDescription?: string | null;
  creatorRewardsRecipient?: string | null;
  owner?: string | null;
  ownerUsername?: string | null;
  creatorRewardsRecipientUsername?: string | null;
}): Promise<number> {
  const res = await farcasterDb
    .insert(tokenMetadata)
    .values({
      contractAddress: contractAddress.toLowerCase(),
      tokenId,
      url: cleanUrl(url),
      platform: 'zora',
      name,
      description,
      image,
      animationUrl,
      contentMime,
      contentUri,
      contentAiDescription,
      creatorRewardsRecipient: creatorRewardsRecipient?.toLowerCase(),
      owner: owner?.toLowerCase(),
      ownerUsername,
      creatorRewardsRecipientUsername,
    })
    .onConflictDoUpdate({
      target: [tokenMetadata.contractAddress, tokenMetadata.tokenId],
      set: {
        contentAiDescription: sql`EXCLUDED.content_ai_description`,
        owner: sql`EXCLUDED.owner`,
        ownerUsername: sql`EXCLUDED.owner_username`,
        creatorRewardsRecipient: sql`EXCLUDED.creator_rewards_recipient`,
        creatorRewardsRecipientUsername: sql`EXCLUDED.creator_rewards_recipient_username`,
      },
    });

  return res.rowCount || 0;
}

function cleanUrl(url: string) {
  return url.split('?')[0];
}
