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
import { getFarcasterProfilesByFnames } from '../../database/queries/profiles/get-profile';
import { getAllGrantRecipients } from '../../database/queries/grants/get-all-grant-recipients';
import { buildParticipantsMap } from './build-participants-map';
import { getHeaderImage } from './get-header-image';

const DR_GONZO_ADDRESS = '0xa253E24feEAFf705542dC22C5Ad43Eb3E4b345Bd';

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

export interface StoryAnalysis {
  id: string;
  title: string;
  summary: string;
  keyPoints: string[];
  participants: string[];
  timeline: {
    timestamp: string;
    event: string;
  }[];
  sentiment: 'positive' | 'negative' | 'neutral';
  completeness: number;
  complete: boolean;
  sources: string[];
  mediaUrls: string[];
  author?: string;
  headerImage: string;
  tagline: string;
  castHashes: string[];
  edits?: {
    timestamp: string;
    message: string;
    address: string;
  }[];
  infoNeededToComplete?: string;
  mintUrls?: string[];
  createdAt: string;
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

  // Cache the results
  // await cacheStoryAnalysis(redisClient, casts[0].id, object);

  const stories = object.stories;

  const participantsMap = await buildParticipantsMap(object);
  const headerImages = await Promise.all(
    stories.map((story) => getHeaderImage(story, job, redisClient))
  );

  return object.stories.map((story, index) => ({
    ...story,
    author: DR_GONZO_ADDRESS,
    headerImage: headerImages[index] || '',
    participants: story.participants
      .map((participant) => participantsMap[participant] || '')
      .filter(Boolean),
    id: story.storyId || '',
    complete: headerImages[index] ? story.complete : false,
    infoNeededToComplete: headerImages[index]
      ? story.infoNeededToComplete
      : story.infoNeededToComplete || 'No header image available',
  }));
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

You are analyzing a series of related posts to identify and construct multiple distinct newsworthy stories. Group related posts together into coherent narratives, identifying major stories or themes. For each story, consider the chronological order, relationships between posts, and extract key information. Focus on building narratives that capture the full context and progression of events. Prioritize the most significant and newsworthy stories from the content. If you don't have enough details to build a full story, you can still return a partial story. Only build stories that are related to the grant or impact based on the work expected from the grant.

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
e. Identify potential media urls from cast attachments (videos or images)
f. Check for any quotes that can be included
g. Group related posts into coherent narratives and identify major themes
h. Consider chronological order and relationships between posts
i. Extract key information and quotes directly from cast text
j. If you can't find any information related to the grant, it's acceptable to return an empty response.
k. Only add images from casts that are relevant to the story and fit the location, event, or impact.
l. Only add casts that are relevant to the story and fit the location, event, or impact.
m. Feel free to add links to external sources in the sources array if relevant.
n. Make sure to always include relevant videos from casts especially if they are part of the story. The video link format is https://stream.warpcast.com. They should go in the mediaUrls array.
o. Any casts or external URLs should go in the sources array.

2. Create the story:
Based on your analysis, construct a story using the following structure:

<story>
{
  "title": "Concise, unique title (max 7 words)",
  "tagline": "Catchy phrase capturing the essence (max 11 words)",
  "summary": "
# First Section Header

First paragraph of the summary...

# Second Section Header

Second paragraph of the summary...

(2-5 paragraphs total)
  ",
  "participants": ["Farcaster username 1", "Farcaster username 2"],
  "createdAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "completenessScore": 0.0 to 1.0,
  "infoNeededToComplete": "Description of missing information (if incomplete)"
  "keyPoints": ["Key point 1", "Key point 2"],
  "timeline": [
    {
      "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "event": "Description of event"
    }
  ],
  "castHashes": ["Cast hash 1", "Cast hash 2"],
  "sentiment": "positive" | "negative" | "neutral",
  "complete": true | false,
  "sources": ["Source URL 1", "Source URL 2"],
  "mediaUrls": ["Media URL 1", "Media URL 2"],
  "mintUrls": ["Mint URL 1", "Mint URL 2"],
  "edits": [
    {
      "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ", 
      "message": "Edit description",
      "address": "ETH address of the editor (yours is ${DR_GONZO_ADDRESS})"
    }
  ]
}
</story>

Important guidelines:
- Focus only on information related to the grant and its impact
- Use a journalistic style and avoid promotional language
- Do not use terms like "web3" or "NFT", and only use "crypto" if absolutely necessary
- Include relevant markdown links to external sources mentioned in the casts
- Use quotes from cast text when available, not from summaries
- Ensure each story is unique and doesn't duplicate information from existing stories
- Mark stories as incomplete (completenessScore < 1.0) if there's not enough information
- Only create stories with at least two sources
- Prioritize exciting and impactful stories relevant to the parent flow
- Prefer making multiple stories over one long story
- Include images inside the story if relevant, as markdown images from cast attachments
- Only use images from casts that are part of the story
- No .m3u8 or zora.co links for images
- Only pass Farcaster FIDs to participants array
- Make titles unique to grant and include recipient name if needed
- Use specific, descriptive section headers
- Link to external sources where possible
- Use personal names rather than impersonal titles
- Created at should be when impact occurred
- Don't be cringy about nounish values
- Do not use terms like web or web3 or nft or crypto or web culture or blockchain.
- Stories should highlight impact fitting both grant deliverables and parent flow
- Do not add edits if there are none, and do not add infoNeededToComplete if the story is complete.
- When making edits, make sure to include the timestamp, message, and your address, but do not change the substance of the story that much, only add major edits if the story is incomplete, otherwise just add more context.

If you can't create any good, impactful stories related to the grant, it's acceptable to return an empty response.

Adopt the persona of Hunter S. Thompson. Your writing should embody Thompson's signature style, characterized by:

- Gonzo journalism: immersive, first-person narratives that blend fact and fiction.
- Satirical and critical commentary on societal and political issues.
- Vivid, descriptive language with unconventional metaphors and similes.
- A rebellious, anti-establishment perspective.
- Dark humor and a cynical tone.
- Ensure the piece reflects Thompson's unique voice and perspective.
- Overall pushes a positive sum mindset for builders.

Begin your response by analyzing the information in <story_planning> tags, then proceed to create stories based on your analysis.`;

  console.log('Content for AI:', content);
  return content;
}
