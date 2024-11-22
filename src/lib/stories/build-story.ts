import { generateObject, generateText } from 'ai';
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

  console.log('Text for AI:', text.text);

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
            content: `You are Hunter S. Thompson, an expert journalist creating stories based on the analysis. You will receive
              a series of texts with the following format:
              <story_planning>
              ...
              </story_planning>
              and you will need to create a story based on the analysis and returned intial draft.`,
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

function getTextFromUserMessage(
  combinedContent: {
    content: string;
    timestamp: Date | null;
  }[],
  existingStories: GrantStories,
  grant: { description: string | null },
  parentGrant: { description: string | null }
): string {
  const content = `You are an expert journalist tasked with analyzing grant-related posts and constructing newsworthy stories about the impact of grant recipients. Your goal is to create compelling narratives that showcase the real-world effects of the funded projects.

First, review the following context:

Existing Stories:
<stories>
${JSON.stringify(
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
)}
</stories>

New Casts:
<casts>
${JSON.stringify(combinedContent, null, 2)}
</casts>

Grant Description:
<grant>
${grant.description || 'No description provided.'}
</grant>

Parent Flow Description:
<flow>
${parentGrant.description || 'No description provided.'}
</flow>

Now, follow these steps to create impactful stories:

1. Analyze the information:
Break down the information inside <story_planning> tags. Consider the following:
a. Summarize key themes from the grant description
b. List and categorize relevant information from casts
c. Identify potential story angles and their supporting evidence
d. Evaluate completeness of information for each potential story
e. Identify potential header images from cast attachments
f. Check for any quotes that can be included

2. Create the story:
Based on your analysis, construct a story using the following structure:

<story>
{
  "title": "Concise, unique title (max 10 words)",
  "tagline": "Catchy phrase capturing the essence (max 12 words)",
  "headerImage": "URL of the best relevant image (omit if none available)",
  "summary": "
# First Section Header

First paragraph of the summary...

# Second Section Header

Second paragraph of the summary...

(2-5 paragraphs total, each with an h1 markdown header)
  ",
  "participants": ["Farcaster username 1", "Farcaster username 2"],
  "createdAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "completenessScore": 0.0 to 1.0,
  "infoNeededToComplete": "Description of missing information (if incomplete)"
}
</story>

Important guidelines:
- Focus only on information related to the grant and its impact
- Use a journalistic style and avoid promotional language
- Do not use terms like "web3" or "NFT", and only use "crypto" if absolutely necessary
- Include relevant markdown links to external sources mentioned in the casts
- Use quotes from cast text when available, not from summaries
- Ensure each story is unique and doesn't duplicate information from existing stories
- Mark stories as incomplete (completenessScore < 1.0) if there's not enough information or no header image available
- Only create stories with at least two sources
- Prioritize exciting and impactful stories relevant to the parent flow
- Prefer making multiple stories over one long story

If you can't create any good, impactful stories related to the grant, it's acceptable to return an empty response.

Begin your response by analyzing the information in <story_planning> tags, then proceed to create stories based on your analysis.`;

  console.log('Content for AI:', content);
  return content;
}
