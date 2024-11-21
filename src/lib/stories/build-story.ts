import { generateObject } from 'ai';
import { z } from 'zod';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastForStory } from '../../database/queries/casts/casts-for-story';
import { openAIModel, anthropicModel, retryAiCallWithBackoff } from '../ai';
import { generateCastText, generateCastTextForStory } from '../casts/utils';
import { getCachedStoryAnalysis, cacheStoryAnalysis } from './cache';
import { GrantStories } from '../../database/queries/stories/get-grant-stories';
import { log } from '../helpers';

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

export type StoryAnalysis = Awaited<ReturnType<typeof buildStory>>[number];

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
) {
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
              headerImage: z.string().describe('The best image from the story'),
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
              mediaUrls: z
                .array(z.string())
                .describe('Media urls from the story'),
              edits: z
                .array(
                  z.object({
                    timestamp: z.string(),
                    message: z.string(),
                  })
                )
                .describe('Edits to the story')
                .optional(),
              infoNeededToComplete: z
                .string()
                .describe('Information needed to complete the story')
                .optional(),
            })
          ),
        }),
        messages: [
          {
            role: 'system',
            content: `You are analyzing a series of related posts to identify and construct multiple distinct newsworthy stories.
                     Group related posts together into coherent narratives, identifying major stories or themes.
                     For each story, consider the chronological order, relationships between posts, and extract key information.
                     Focus on building narratives that capture the full context and progression of events.
                     Prioritize the most significant and newsworthy stories from the content.
                     If you don't have enough details to build a full story, you can still return a partial story.
                     Only build stories that are related to the grant or impact based on the work expected from the grant.

                     # Participants
                     Only pass Farcaster usernames of the user profiles to the participants array, not usernames. You can get these from the casts.

                     # Images
                     Include images inside the story if there are any relevant images for each section. Include them as markdown images, taken from the cast attachments.
                     Include the best image as a header image for the story. Do not make up images or urls. Only include images from the image delivery cast attachments.
                     Any urls that include .m3u8 are videos, and should not be the header image.

                     # Title
                     Make the title of the story concise and only a few words max. The stories will be shown in a grid, 
                     with stories from other grants, so make the title unique to the grant and descriptive, but very concise.
                     Make sure the title is not too generic. If you need more details, you should include a shortened name of the recipient if it makes sense.

                     # Summary
                     The story should be composed into 2-5 paragraphs, each with an h1 markdown header. The paragraphs should
                     be at least a few sentences each. If you don't have enough information to write a paragraph, you can mark
                     the story as incomplete. Feel free to link to any external sources included in the casts that are relevant to the story.
                     Use markdown links where possible.

                     Don't be cringy about the headers for each section, be specific and descriptive.

                     The summary should be a comprehensive summary of all events, written in a journalistic style.
                     The story should be written in a way that is easy to understand and follow, in a journalistic style.
                     The story will be attached to a grant, and you should only write about things that are related to the grant.
                     Additionally, the story should fit under the requirements of the parent flow, and ideally highlight
                     impact that fits both the grant deliverables and the parent flow requirements.

                     # Sources
                     Always keep your stories grounded in source material, never make up information.

                     Never ever use the word "web3" or "NFT", and only use crypto if absolutely necessary.

                     # People
                     When mentioning people, only mention their names, do not call them impersonal titles.

                     # Created at
                     The created at timestamp should be the timestamp of when the story impact occurred.

                     # Tagline
                     The tagline should be a short, catchy phrase that captures the essence of the story, and is no more than 12 words.

                     # Quotes
                     If you are able to add quotes from the builder or from community members to the markdown, do so.
                     Only use quotes from the cast text over quotes from the summary.

                     # Language
                     Don't be cringy about referring to nounish values.

                     # Info needed to complete
                     If you don't have enough information to write a story, you can mark the story as incomplete, and set the completeness score to something less than 1.
                     If you don't have enough information to write a story, you can add a string to the infoNeededToComplete field.
                     This string should describe what information is needed to complete the story.
                     Only create stories that have at least two sources. If you don't have enough information to write a story, you should mark the story as incomplete.

                     # Existing stories
                     Do not duplicate information across stories, try to make each story about unique impact that has occurred.
                     Focus on exciting and impactful stories that people interested in the worldwide impact of the parent flow will want to read.

                     Feel free to not return any stories if you don't have any good ideas. Do not force stories that are not good or impactful to the grant.
                     `,
          },
          {
            role: 'user',
            content: `Here is the combined content of new casts that haven't been used in existing stories:\n${JSON.stringify(
              combinedContent,
              null,
              2
            )}\n\nHere are the existing stories for this grant:\n${JSON.stringify(
              existingStories.map((story) => ({
                id: story.id,
                title: story.title,
                summary: story.summary,
                keyPoints: story.keyPoints,
                participants: story.participants,
                timeline: story.timeline,
                completeness: story.completeness,
                complete: story.complete,
                sources: story.sources,
                tagline: story.tagline,
              })),
              null,
              2
            )}\n\nGrant description: ${
              grant.description || 'No description provided.'
            }\nParent flow description: ${
              parentGrant.description || 'No description provided.'
            }`,
          },
        ],
        maxTokens: 4000,
      }),
    job,
    [anthropicModel, openAIModel]
  );

  console.log(JSON.stringify(object, null, 2));

  // Cache the results
  // await cacheStoryAnalysis(redisClient, casts[0].id, object);

  return object.stories.map((story) => {
    if (!story.headerImage) {
      story.complete = false;
      story.completeness = Math.min(story.completeness, 0.8);
    }
    return story;
  });
}
