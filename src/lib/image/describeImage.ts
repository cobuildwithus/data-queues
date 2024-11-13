import { OpenAI } from 'openai';
import { RedisClientType } from 'redis';

// Initialize the OpenAI client with your API key
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure your API key is stored securely
});

const nonImageDomains = [
  'youtube',
  'm3u8',
  'mp4',
  'vrbs.build',
  'youtu.be',
  'vimeo',
];

const IMAGE_DESCRIPTION_CACHE_PREFIX = 'image-description:';

async function getCachedImageDescription(
  redisClient: RedisClientType,
  imageUrl: string
): Promise<string | null> {
  return await redisClient.get(`${IMAGE_DESCRIPTION_CACHE_PREFIX}${imageUrl}`);
}

async function cacheImageDescription(
  redisClient: RedisClientType,
  imageUrl: string,
  description: string
): Promise<void> {
  await redisClient.set(
    `${IMAGE_DESCRIPTION_CACHE_PREFIX}${imageUrl}`,
    description
  );
}

/**
 * Analyzes an image from a URL and returns a description.
 * @param imageUrl - The URL of the image to analyze.
 * @param redisClient - Redis client for caching
 * @returns A promise that resolves to the description of the image.
 */
export async function describeImage(
  imageUrl: string,
  redisClient: RedisClientType
): Promise<string | null> {
  // return null if imageUrl is a youtube video
  if (nonImageDomains.some((domain) => imageUrl.includes(domain))) {
    return null;
  }

  // Convert imagedelivery URL before attempting to process
  if (imageUrl.startsWith('https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw')) {
    imageUrl = convertImageDeliveryUrl(imageUrl);
  }

  // Check cache first
  const cachedDescription = await getCachedImageDescription(
    redisClient,
    imageUrl
  );
  if (cachedDescription) {
    return cachedDescription;
  }

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      // Create a chat completion request with the image URL
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Please provide a detailed description of the following image, 
                  focusing on all visible elements, their relationships, and the overall context. 
                  Don't include too much data about the image, just the important details that contribute to the overall meaning.
                  Ensure that you first define what exactly you believe the image is, whether it's a photo, a painting, a drawing, screenshot of a web page etc.
                  Include information on subjects, actions, settings, emotions, and any inferred meanings to facilitate accurate embedding. 
                  If you see a person wearing square glasses, especially if they are red, they might be called noggles, so mention the word noggles if it's relevant.
                  Make sure to pay attention to glasses and these details, but you don't need to mention them in the description if they are not present in the image.
                  The information you share will be fed to an embedding model, so don't use new lines or other formatting. Make it all lowercase.
                  DO NOT return anything if you cannot access the image or it is otherwise unavilable. Just return an empty string.`,
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      });

      // Extract and return the assistant's response
      const description = response.choices[0]?.message?.content;
      console.log({ description, imageUrl });

      // Cache the result if it's not the default message
      if (description) {
        await cacheImageDescription(redisClient, imageUrl, description);
      }

      return description;
    } catch (error: any) {
      if (attempts === maxAttempts) {
        handleMaxAttemptsError(imageUrl, error);
        return null;
      }

      if (error?.status === 429) {
        attempts++;
        await handleRateLimitError();
      } else {
        return await handleOtherErrors(error, imageUrl, redisClient);
      }
    }
  }
  return null;
}

function handleMaxAttemptsError(imageUrl: string, error: any) {
  console.error('Rate limit reached after max retries', imageUrl);
  console.error(error);
}

async function handleRateLimitError() {
  await new Promise((resolve) => setTimeout(resolve, 30000));
}

async function handleOtherErrors(
  error: any,
  imageUrl: string,
  redisClient: RedisClientType
): Promise<string | null> {
  if (
    error.code === 'invalid_image_url' ||
    error.code === 'invalid_image_format'
  ) {
    if (imageUrl.startsWith('https://imagedelivery.net/')) {
      const newUrl = convertImageDeliveryUrl(imageUrl);
      return await describeImage(newUrl, redisClient);
    }
    console.error(`${error.code}:`, imageUrl);
  } else {
    console.error('Error describing image');
    console.error(error, imageUrl);
  }
  return null;
}

function convertImageDeliveryUrl(imageUrl: string): string {
  return imageUrl
    .replace('imagedelivery.net', 'wrpcd.net/cdn-cgi/imagedelivery')
    .replace(/\/([^/]+)\/original$/, (_, id) => `/${id}/rectcontain3`);
}
