import { farcasterCasts } from '../../database/farcaster-schema';
import { inArray, sql } from 'drizzle-orm';
import { StoryAnalysis } from './build-story';
import { generateObject } from 'ai';
import { z } from 'zod';
import { anthropicModel, openAIModel, retryAiCallWithBackoff } from '../ai';
import { Job } from 'bullmq';
import { farcasterDb } from '../../database/farcasterDb';
import { describeImage } from '../multi-media/image/describe-image';
import { RedisClientType } from 'redis';
import { log } from '../helpers';
import { getCastHash } from '../casts/utils';

export async function getHeaderImage(
  story: Omit<StoryAnalysis, 'headerImage' | 'id'>,
  job: Job,
  redisClient: RedisClientType
): Promise<string | null> {
  // Get all casts referenced in the story
  const castHashes = story.castHashes.map((hash) => getCastHash(hash));

  if (!castHashes.length) {
    return null;
  }

  console.log('Getting header image for story with cast hashes', castHashes);

  const relevantCasts = await farcasterDb
    .select({
      embeds: farcasterCasts.embeds,
      text: farcasterCasts.text,
      embedSummaries: farcasterCasts.embedSummaries,
    })
    .from(farcasterCasts)
    .where(inArray(farcasterCasts.hash, castHashes));

  log(`Found ${relevantCasts.length} relevant casts`, job);

  // Extract image URLs and descriptions from cast embeds
  const imageUrls: { url: string; description: string | null }[] = [];

  for (const cast of relevantCasts) {
    if (!cast.embeds) continue;

    const embedsArray = Array.isArray(cast.embeds)
      ? cast.embeds
      : [cast.embeds];

    console.log('embedsArray', embedsArray);

    for (const embed of embedsArray) {
      // Parse the JSON string if needed
      let parsedEmbed;
      try {
        parsedEmbed = typeof embed === 'string' ? JSON.parse(embed) : embed;
      } catch (e) {
        console.log('Failed to parse embed:', embed);
        continue;
      }

      // Handle array of embeds
      const embedsToProcess = Array.isArray(parsedEmbed)
        ? parsedEmbed
        : [parsedEmbed];

      for (const singleEmbed of embedsToProcess) {
        const url = singleEmbed.url || singleEmbed;

        if (
          typeof url === 'string' &&
          url.match(/\.(jpg|jpeg|png|gif|webp)$/i) &&
          !url.includes('.m3u8') &&
          !url.includes('zora.co')
        ) {
          // Get description from embed summaries if available
          let description = null;
          if (cast.embedSummaries && Array.isArray(cast.embedSummaries)) {
            description =
              cast.embedSummaries.find((summary) => summary.includes(url)) ||
              null;
          }

          // If no description found, generate one using describeImage
          if (!description) {
            description = await describeImage(url, redisClient, job);
          }

          imageUrls.push({
            url,
            description,
          });
        }
      }
    }
  }

  // Also include any media URLs from the story that are images
  if (story.mediaUrls) {
    for (const url of story.mediaUrls) {
      if (
        url.match(/\.(jpg|jpeg|png|gif|webp)$/i) &&
        !url.includes('.m3u8') &&
        !url.includes('zora.co')
      ) {
        const description = await describeImage(url, redisClient, job);
        imageUrls.push({
          url,
          description,
        });
      }
    }
  }

  console.log('imageUrls', imageUrls);

  if (imageUrls.length === 0) {
    return null;
  }

  // Use AI to analyze images and pick the best header image
  const { object } = await retryAiCallWithBackoff(
    (model) => () =>
      generateObject({
        model,
        schema: z.object({
          bestImageUrl: z.string().describe('URL of the best image for header'),
          reason: z.string().describe('Reason this image was selected'),
        }),
        messages: [
          {
            role: 'system',
            content:
              'You are an AI assistant that analyzes images to select the best header image for a story.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Story Title: ${story.title}
Story Summary: ${story.summary}
Available Images: ${imageUrls.map((img) => `${img.url}${img.description ? ` - ${img.description}` : ''}`).join('\n')}

Please analyze these images and select the best one for the story header based on:
1. Image quality and resolution
2. Relevance to story content
3. Visual appeal and composition
4. Professional appearance
5. Ability to capture reader attention

Select the image that best represents the story's main theme or impact.`,
              },
            ],
          },
        ],
        maxTokens: 1000,
      }),
    job,
    [anthropicModel, openAIModel]
  );

  return object.bestImageUrl;
}
