import neynarClient from './client';

export async function publishFarcasterCast(
  signerUuid: string,
  text: string,
  parentHash: string | null,
  parentAuthorFid: number | null
) {
  try {
    const response = await neynarClient.publishCast({
      signerUuid,
      text,
      parent: parentHash ?? undefined,
      parentAuthorFid: parentAuthorFid ?? undefined,
      idem: uniqueIdem(
        text,
        parentHash ?? undefined,
        parentAuthorFid ?? undefined
      ),
    });

    console.log('Cast published:', response.cast);
    return response.cast;
  } catch (error) {
    console.error('Error publishing cast:', error);
    throw error;
  }
}

function uniqueIdem(text: string, parent?: string, parentAuthorFid?: number) {
  return `${Date.now()}-${Math.random()}-${text}-${parent}-${parentAuthorFid}`;
}
