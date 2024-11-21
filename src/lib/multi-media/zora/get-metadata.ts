import { farcasterDb } from '../../../database/farcasterDb';
import { tokenMetadata } from '../../../database/token-metadata-schema';
import { eq, and } from 'drizzle-orm';

/**
 * Gets Zora NFT metadata from the database if it exists
 */
export async function getZoraTokenMetadata(
  contractAddress: string,
  tokenId: string
) {
  const metadata = await farcasterDb
    .select()
    .from(tokenMetadata)
    .where(
      and(
        eq(tokenMetadata.contractAddress, contractAddress.toLowerCase()),
        eq(tokenMetadata.tokenId, tokenId)
      )
    )
    .limit(1);

  return metadata[0] || null;
}
