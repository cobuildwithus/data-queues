import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastForStory } from '../../../database/queries/casts/casts-for-story';
import { openAIModel, anthropicModel, retryAiCallWithBackoff } from '../../ai';
import { generateCastTextForStory } from '../../casts/utils';
import { GrantStories } from '../../../database/queries/stories/get-grant-stories';
import { log } from '../../helpers';
import { buildParticipantsMap } from '../participants/build-participants-map';
import { getHeaderImage } from '../header-image/get-header-image';
import { getMediaUrls } from '../media-urls/get-media-urls';
import { getTextFromUserMessage } from './get-prompt-text';
import { StoryAnalysis } from './story-analysis';
import { DR_GONZO_ADDRESS } from '../config';

export async function buildStories(
  redisClient: RedisClientType,
  casts: CastForStory[],
  job: Job,
  grant: { description: string },
  parentGrant: { description: string },
  existingStories: GrantStories
): Promise<StoryAnalysis[]> {
  return buildStory(
    redisClient,
    casts,
    job,
    grant,
    parentGrant,
    existingStories
  );
}

async function buildStory(
  redisClient: RedisClientType,
  casts: CastForStory[],
  job: Job,
  grant: {
    description: string;
  },
  parentGrant: {
    description: string;
  },
  existingStories: GrantStories
): Promise<StoryAnalysis[]> {
  if (!casts || casts.length === 0) {
    throw new Error('Stories data is required');
  }

  // Get cast text with summaries for all casts
  const castTextsPromises = casts.map((cast) =>
    generateCastTextForStory(cast, redisClient, job)
  );
  const castTexts = await Promise.all(castTextsPromises);

  // Combine all cast content and summaries
  const combinedContent = castTexts
    .map((text, index) => ({
      content: text,
      timestamp: casts[index].timestamp,
    }))
    .sort(
      (a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0)
    );

  log('Generating stories', job);

  const text = await retryAiCallWithBackoff(
    (model) => () =>
      generateText({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are Hunter S. Thompson, writing a story about the grant.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: getTextFromUserMessage(
                  combinedContent,
                  existingStories,
                  grant,
                  parentGrant
                ),
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '<story_planning>',
              },
            ],
          },
        ],
        maxTokens: 4000,
      }),
    job,
    [anthropicModel, openAIModel]
  );

  const { object } = await retryAiCallWithBackoff(
    (model) => () =>
      generateObject({
        model,
        schema: z.object({
          stories: z.array(
            z.object({
              storyId: z.string().describe('The id of the story').optional(),
              title: z.string().describe('A concise title for the story'),
              summary: z
                .string()
                .describe('A comprehensive summary of all events'),
              keyPoints: z
                .array(z.string())
                .describe('Key points from the story'),
              participants: z
                .array(z.string())
                .describe(
                  'Farcaster IDs of key participants/stakeholders mentioned'
                ),
              tagline: z.string().describe('A short tagline for the story'),
              timeline: z
                .array(
                  z.object({
                    timestamp: z.string(),
                    event: z.string(),
                  })
                )
                .describe('Timeline of major events'),
              castHashes: z
                .array(z.string())
                .describe('The ids of the casts that are part of the story'),
              sentiment: z
                .enum(['positive', 'negative', 'neutral'])
                .describe('Overall sentiment of the story'),
              completeness: z
                .number()
                .min(0)
                .max(1)
                .describe('Story completeness'),
              complete: z
                .boolean()
                .describe(
                  'Whether the story is complete or if there are missing details'
                ),
              sources: z
                .array(z.string())
                .describe(
                  'Sources of the story, including the cast URLs if applicable'
                ),
              createdAt: z
                .string()
                .describe('The timestamp of the story impact'),
              edits: z
                .array(
                  z.object({
                    timestamp: z.string(),
                    message: z.string(),
                    address: z.string(),
                  })
                )
                .describe('Edits to the story')
                .optional(),
              infoNeededToComplete: z
                .string()
                .describe('Information needed to complete the story')
                .optional(),
              mintUrls: z
                .array(z.string())
                .describe('Mint urls from the story')
                .optional(),
              author: z
                .string()
                .describe(
                  'The ETH address of the author (yours is ' +
                    DR_GONZO_ADDRESS +
                    ')'
                )
                .optional(),
            })
          ),
        }),
        messages: [
          {
            role: 'system',
            content: `You are Hunter S. Thompson, an expert journalist creating stories based on the analysis. You will receive
              a series of texts with the following format:
              <story_planning>
              ...
              </story_planning>
              and you will need to create a set of stories based on the analysis and returned intial draft.
              Adopt the persona of Hunter S. Thompson. Your writing should embody Thompson's signature style, characterized by:

              - Gonzo journalism: immersive, first-person narratives that blend fact and fiction.
              - Satirical and critical commentary on societal and political issues.
              - Vivid, descriptive language with unconventional metaphors and similes.
              - A rebellious, anti-establishment perspective.
              - Dark humor and a cynical tone.
              - Ensure the piece reflects Thompson's unique voice and perspective.
              - Overall pushes a positive sum mindset for builders.

              Do not summarize the summary or stories in any way, use the same text as provided to generate the objects.
              Do not remove the headers from the story summary or otherwise alter the text or data provided to you.
              Do not forget to include all the fields like castHashes, edits, mintUrls, infoNeededToComplete, etc.
              `,
          },
          {
            role: 'user',
            content: text.text,
          },
        ],
        maxTokens: 4000,
      }),
    job,
    [anthropicModel, openAIModel]
  );

  console.log(JSON.stringify(object, null, 2));

  const stories = object.stories;

  const [participantsMap, mediaUrls] = await Promise.all([
    buildParticipantsMap(object),
    Promise.all(stories.map((story) => getMediaUrls(story, job, redisClient))),
  ]);

  const headerImages = await Promise.all(
    stories.map((story, index) =>
      getHeaderImage(story, mediaUrls[index] || [], job, redisClient)
    )
  );

  return object.stories.map((story, index) => ({
    ...story,
    author: DR_GONZO_ADDRESS,
    headerImage: headerImages[index] || '',
    participants: story.participants
      .map((participant) => participantsMap[participant] || '')
      .filter(Boolean),
    id: story.storyId || '',
    mediaUrls: mediaUrls[index] || [],
    complete: headerImages[index] ? story.complete : false,
    infoNeededToComplete: headerImages[index]
      ? story.infoNeededToComplete
      : story.infoNeededToComplete || 'No header image available',
  }));
}
