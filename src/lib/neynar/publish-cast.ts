import { FarcasterAgentAnalysis } from '../farcaster-agent/cache';
import neynarClient from './client';

export async function publishFarcasterCast(
  signerUuid: string,
  agentFid: number,
  analysis: FarcasterAgentAnalysis
) {
  try {
    const {
      proposedReply: text,
      replyToCastId,
      replyToHash,
      replyToFid,
    } = analysis;
    const response = await neynarClient.publishCast({
      signerUuid,
      text,
      parent: replyToHash ?? undefined,
      parentAuthorFid: replyToFid ?? undefined,
      idem: uniqueIdem(agentFid, replyToCastId),
    });

    console.log('Cast published:', response.cast);
    return response.cast;
  } catch (error) {
    console.error('Error publishing cast:', error);
    throw error;
  }
}

export function uniqueIdem(agentFid: number, replyToCastId: number | null) {
  return `${agentFid}-${replyToCastId}`;
}
