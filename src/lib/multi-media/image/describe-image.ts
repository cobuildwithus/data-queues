import { Job } from 'bullmq';
import fs from 'fs';
import { RedisClientType } from 'redis';
import { log } from '../../helpers';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { imageDescriptionPrompt } from '../../prompts/media-descriptions';
import { cacheImageDescription, getCachedImageDescription } from './cache';
import { downloadAndProcessImage, getImageUrl } from './utils';
import { uploadAndWaitForProcessing } from '../../google/ai-file-manager';
import { retryWithExponentialBackoff } from '../../retry/retry-fetch';

const fsPromises = fs.promises;

if (!process.env.GOOGLE_AI_STUDIO_KEY) {
  throw new Error('GOOGLE_AI_STUDIO_KEY environment variable is required');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_AI_STUDIO_KEY);

/**
 * Analyzes an image from a URL and returns a description.
 * @param imageUrl - The URL of the image to analyze.
 * @param redisClient - Redis client for caching
 * @returns A promise that resolves to the description of the image.
 */
export async function describeImage(
  rawImageUrl: string,
  redisClient: RedisClientType,
  job: Job
): Promise<string | null> {
  // Validate URL format and check if it's from an allowed image domain
  const imageUrl = getImageUrl(rawImageUrl, job);

  if (!imageUrl) {
    log(`Skipping image from non-allowed domain: ${rawImageUrl}`, job);
    return null;
  }

  log(`Starting image description process for: ${imageUrl}`, job);

  const cachedDescription = await getCachedImageDescription(
    redisClient,
    imageUrl,
    job
  );
  if (cachedDescription) {
    log('Returning cached image description', job);
    return cachedDescription;
  }

  const tempFilePath = `/tmp/image-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.tmp`;

  try {
    const processedImage = await downloadAndProcessImage(imageUrl, job);

    if (!processedImage) {
      return null;
    }

    // Write buffer to temp file
    await fsPromises.writeFile(
      tempFilePath,
      new Uint8Array(processedImage.buffer)
    );

    const uploadResponse = await uploadAndWaitForProcessing(
      fileManager,
      tempFilePath,
      processedImage.mimeType,
      job
    );

    // Clean up temp file
    await fsPromises.unlink(tempFilePath);

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

    // log(`Result from generateContent: ${JSON.stringify(result, null, 2)}`, job);

    const description = result.response.text();
    log('Generated description: ' + description, job);

    // Cache and delete the file after processing
    if (description) {
      log('Caching image description', job);
      await cacheImageDescription(redisClient, imageUrl, description, job);
    }
    log('Cleaning up Google AI Studio file', job);
    await fileManager.deleteFile(uploadResponse.file.name);

    return description;
  } catch (error: any) {
    try {
      await fsPromises.unlink(tempFilePath);
    } catch (unlinkError: any) {
      log(`Error deleting temp file: ${unlinkError.message}`, job);
    }
    log(`Error describing image: ${error.message}`, job);
    log(error.stack, job);
    return null;
  }
}
