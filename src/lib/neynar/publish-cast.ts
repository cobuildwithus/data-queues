import { FarcasterAgentJobBody } from '../../types/job';
import { FarcasterAgentAnalysis } from '../farcaster-agent/cache';
import neynarClient from './client';

export async function publishFarcasterCast(
  signerUuid: string,
  agentFid: number,
  analysis: FarcasterAgentAnalysis,
  jobData: FarcasterAgentJobBody
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
      // cooler to have lower case text
      text: text.toLowerCase(),
      parent: replyToHash ?? undefined,
      parentAuthorFid: replyToFid ?? undefined,
      idem: uniqueIdem(agentFid, replyToCastId),
      embeds: jobData.urlsToInclude.map((url) => ({ url })),
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
