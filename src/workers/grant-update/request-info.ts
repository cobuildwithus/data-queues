import { Queue } from 'bullmq';
import { CastAnalysis } from '../../lib/casts/cache';
import { DR_GONZO_FID } from '../../lib/config';
import { FarcasterAgentJobBody } from '../../types/job';

export async function requestMoreInfoFromBuilder(
  result: CastAnalysis,
  farcasterAgentQueue: Queue<FarcasterAgentJobBody>
) {
  await farcasterAgentQueue.add(`farcaster-agent-${Date.now()}`, {
    agentFid: DR_GONZO_FID,
    customInstructions: `
    You are currently responding to a cast that is nearly a grant update for a Flows grant, but not quite. 
    Please ask the builder for more information to complete the update so that you can write a story about it.
    The grant update analysis returned the following:
    ${JSON.stringify(result, null, 2)}
    Take this information into account when considering how to respond to the builder.
    You can inform the builder that you are working on a story about their impact.`,
    replyToCastId: result.cast.id,
    postToChannelId: null,
    urlsToInclude: [],
  });
}
