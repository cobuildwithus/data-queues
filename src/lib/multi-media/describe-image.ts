import { Job } from 'bullmq';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { RedisClientType } from 'redis';
import { log } from '../queueLib';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { nonImageDomains } from './domains';
import { imageDescriptionPrompt } from '../prompts/builder-profile';

if (!process.env.GOOGLE_AI_STUDIO_KEY) {
  throw new Error('GOOGLE_AI_STUDIO_KEY environment variable is required');
}

const IMAGE_DESCRIPTION_CACHE_PREFIX = 'ai-studio-image-description:';
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_AI_STUDIO_KEY);

async function getCachedImageDescription(
  redisClient: RedisClientType,
  imageUrl: string,
  job: Job
): Promise<string | null> {
  log(`Checking cache for image description: ${imageUrl}`, job);
  return await getCachedResult<string>(
    redisClient,
    imageUrl,
    IMAGE_DESCRIPTION_CACHE_PREFIX
  );
}

async function cacheImageDescription(
  redisClient: RedisClientType,
  imageUrl: string,
  description: string,
  job: Job
): Promise<void> {
  log(`Caching image description for: ${imageUrl}`, job);
  await cacheResult(
    redisClient,
    imageUrl,
    IMAGE_DESCRIPTION_CACHE_PREFIX,
    async () => description
  );
  log('Image description cached successfully', job);
}

async function downloadImage(
  imageUrl: string,
  outputPath: string,
  job: Job
): Promise<void> {
  log(`Downloading image from ${imageUrl} to ${outputPath}`, job);
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const buffer = await response.buffer();
  fs.writeFileSync(outputPath, new Uint8Array(buffer));
  log('Image downloaded successfully', job);
}

async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  job: Job,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error?.status;
    if (retries > 0 && (status === 503 || status >= 500)) {
      log(`Retrying after ${delay} ms... (${retries} retries left)`, job);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithExponentialBackoff(fn, job, retries - 1, delay * 2);
    } else {
      throw error;
    }
  }
}

function convertImageDeliveryUrl(imageUrl: string): string {
  return imageUrl
    .replace('imagedelivery.net', 'wrpcd.net/cdn-cgi/imagedelivery')
    .replace(/\/([^/]+)\/original$/, (_, id) => `/${id}/rectcontain3`);
}

/**
 * Analyzes an image from a URL and returns a description.
 * @param imageUrl - The URL of the image to analyze.
 * @param redisClient - Redis client for caching
 * @returns A promise that resolves to the description of the image.
 */
export async function describeImage(
  imageUrl: string,
  redisClient: RedisClientType,
  job: Job
): Promise<string | null> {
  log(`Starting image description process for: ${imageUrl}`, job);

  // Check for non-image domains
  const urlObj = new URL(imageUrl);
  if (nonImageDomains.some((domain) => urlObj.hostname.endsWith(domain))) {
    return null;
  }

  // Check if URL is valid and starts with http:// or https://
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    return null;
  }

  // Validate URL format
  try {
    new URL(imageUrl);
  } catch (e) {
    return null;
  }

  // Convert imagedelivery URL before attempting to process
  if (imageUrl.startsWith('https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw')) {
    imageUrl = convertImageDeliveryUrl(imageUrl);
  }

  const cachedDescription = await getCachedImageDescription(
    redisClient,
    imageUrl,
    job
  );
  if (cachedDescription) {
    log('Returning cached image description', job);
    return cachedDescription;
  }

  const imageDir = path.resolve(__dirname, 'images');
  const imageName = path.basename(imageUrl);
  const localFilePath = path.join(imageDir, imageName);

  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }

    log('Starting image download and processing', job);
    // Download image
    await downloadImage(imageUrl, localFilePath, job);

    // Determine mime type based on file extension
    const mimeType = 'image/' + path.extname(localFilePath).substring(1);

    // Upload image file to Google
    log('Uploading image to Google AI Studio', job);
    const uploadResponse = await fileManager.uploadFile(localFilePath, {
      mimeType: mimeType, // Adjust based on your image type
      displayName: 'Image to analyze',
    });
    log('Image uploaded successfully', job);

    // Clean up local image file after upload
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      log('Deleted local image file after upload', job);
    }

    // Check file state until processing is complete
    log('Waiting for image processing to complete', job);
    let file = await fileManager.getFile(uploadResponse.file.name);
    const maxRetries = 30; // e.g., wait for up to 5 minutes
    let retries = 0;

    while (file.state === 'PROCESSING' && retries < maxRetries) {
      log('Image still processing, waiting 10 seconds...', job);
      await new Promise((resolve) => setTimeout(resolve, 10000));
      file = await fileManager.getFile(uploadResponse.file.name);
      retries++;
    }

    if (file.state === 'FAILED') {
      log('Image processing failed', job);
      throw new Error('Image processing failed');
    } else if (file.state === 'PROCESSING') {
      log('Image processing timed out', job);
      throw new Error('Image processing timed out');
    }

    log('Image processing completed successfully', job);

    // Generate description using Gemini Flash with retries
    log('Generating image description with Gemini Flash', job);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await retryWithExponentialBackoff(async () => {
      return await model.generateContent([
        {
          fileData: {
            mimeType: uploadResponse.file.mimeType,
            fileUri: uploadResponse.file.uri,
          },
        },
        {
          text: imageDescriptionPrompt(),
        },
      ]);
    }, job);

    log(`Result from generateContent: ${JSON.stringify(result, null, 2)}`, job);

    const description = result.response.text();
    log('Generated description:' + description, job);

    // Cache and delete the file after processing
    if (description) {
      log('Caching image description', job);
      await cacheImageDescription(redisClient, imageUrl, description, job);
    }
    log('Cleaning up Google AI Studio file', job);
    await fileManager.deleteFile(uploadResponse.file.name);

    return description;
  } catch (error) {
    log('Error describing image:' + error, job);
    return null;
  } finally {
    // Clean up local directory and files
    if (fs.existsSync(imageDir)) {
      log('Cleaning up local image directory', job);
      fs.rmSync(imageDir, { recursive: true, force: true });
    }
  }
}
