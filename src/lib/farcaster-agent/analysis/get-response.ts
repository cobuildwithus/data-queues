import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { FarcasterAgentJobBody } from '../../../types/job';
import { log } from '../../helpers';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import {
  anthropicModel,
  openAIModelO1Mini,
  retryAiCallWithBackoff,
} from '../../ai';
import { googleAiStudioModel, openAIModel } from '../../ai';
import {
  cacheAgentAnalysis,
  FarcasterAgentAnalysis,
  getCachedAgentAnalysis,
} from '../cache';
import { getFarcasterProfile } from '../../../database/queries/profiles/get-profile';
import {
  CastWithParentAndReplies,
  getCastsForAgent,
} from '../../../database/queries/casts/casts-for-agent';
import { getBuilderProfile } from '../../../database/queries/profiles/get-builder-profile';
import { getTextFromAgentData } from '../prompt-text';
import { formatCastForPrompt } from '../cast-utils';
import { GrantWithParent } from '../../../database/queries/grants/get-grant-by-addresses';
import { uniqueIdem } from '../../neynar/publish-cast';

export async function getAgentResponse(
  redisClient: RedisClientType,
  data: FarcasterAgentJobBody,
  job: Job
): Promise<FarcasterAgentAnalysis> {
  if (!data.customInstructions) {
    throw new Error('Custom instructions are required');
  }

  // Create hash of entire job data to use as cache key
  const jobHash = uniqueIdem(data.agentFid, data.replyToCastId);

  // Check cache first
  const cachedAnalysis = await getCachedAgentAnalysis(redisClient, jobHash);
  if (cachedAnalysis) {
    log('Returning cached agent analysis', job);
    return cachedAnalysis;
  }

  const [agentFarcasterProfile, agentBuilderProfile] = await Promise.all([
    getFarcasterProfile(data.agentFid),
    getBuilderProfile(data.agentFid),
  ]);

  // if (!agentFarcasterProfile || !agentBuilderProfile) {
  if (!agentFarcasterProfile) {
    throw new Error(`Agent profiles not found: ${data.agentFid}`);
  }

  // If there's a reply cast ID, we need to fetch that cast's content
  let mainCastContent = '';
  let rootCastContent = '';
  let otherRepliesContent = '';
  let castAuthorBuilderProfile: string | null = null;
  let authorGrants: GrantWithParent[] | null = null;
  let cast: CastWithParentAndReplies | null = null;
  if (data.replyToCastId) {
    log('Fetching reply cast content', job);
    cast = await getCastsForAgent(data.replyToCastId);

    if (!cast || !cast.fid) {
      throw new Error(`Reply cast not found: ${data.replyToCastId}`);
    }

    const [castContent, castAuthor] = await Promise.all([
      formatCastForPrompt(cast, redisClient, job),
      getBuilderProfile(cast.fid),
    ]);

    if (castAuthor) {
      castAuthorBuilderProfile = castAuthor.content;
    } else {
      throw new Error(
        `Replying to cast author builder profile not found: ${cast.fid}`
      );
    }

    authorGrants = cast.authorGrants;

    console.log({ castContent });

    mainCastContent = castContent.mainCastText;
    rootCastContent = castContent.rootCastText;
    otherRepliesContent = castContent.otherRepliesText;
  }

  const text = await retryAiCallWithBackoff(
    (model) => () =>
      generateText({
        model,
        temperature: 1,
        messages: [
          {
            role: 'user',
            content: getTextFromAgentData(
              data.customInstructions,
              agentFarcasterProfile,
              agentBuilderProfile?.content || '',
              data.replyToCastId,
              mainCastContent,
              rootCastContent,
              otherRepliesContent,
              castAuthorBuilderProfile,
              authorGrants
            ),
          },
          {
            role: 'assistant',
            content: `
            <story_planning>
            `,
          },
        ],
      }),
    job,
    [anthropicModel, openAIModelO1Mini]
  );

  log('Agent analysis text', job);
  log(text.text, job);

  const { object } = await retryAiCallWithBackoff(
    (model) => () =>
      generateObject({
        model,
        schema: z.object({
          shouldReply: z.boolean(),
          proposedReply: z.string(),
          reason: z.string().describe('Reasoning behind the response'),
          confidenceScore: z
            .number()
            .describe('Confidence in the response appropriateness'),
        }),
        messages: [
          {
            role: 'system',
            content:
              'You are analyzing whether and how to respond to a Farcaster interaction based on custom instructions.',
          },
          {
            role: 'user',
            content: text.text,
          },
        ],
      }),
    job,
    [anthropicModel, openAIModel, googleAiStudioModel]
  );

  if (!cast) {
    throw new Error('Cast not found');
  }

  log('Agent analysis result', job);
  log(JSON.stringify(object, null, 2), job);
  const result: FarcasterAgentAnalysis = {
    shouldReply: object.shouldReply,
    proposedReply: object.proposedReply,
    reason: object.reason,
    confidenceScore: object.confidenceScore,
    agentFid: data.agentFid,
    replyToCastId: data.replyToCastId || null,
    customInstructions: data.customInstructions,
    replyToHash: cast.hash ? `0x${cast.hash.toString('hex')}` : null,
    replyToFid: cast.fid || null,
  };

  // Cache the analysis
  await cacheAgentAnalysis(redisClient, jobHash, result);

  return result;
}
