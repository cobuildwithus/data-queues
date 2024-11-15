import { Job } from 'bullmq';
import fetch from 'node-fetch';
import fs from 'fs';
import { RedisClientType } from 'redis';
import sharp from 'sharp';
import { log } from '../queueLib';
import { cacheResult, getCachedResult } from '../cache/cacheResult';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { imageDomains, imageRegex } from './domains';
import { imageDescriptionPrompt } from '../prompts/builder-profile';

const fsPromises = fs.promises;

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

async function getImageSize(imageUrl: string, job: Job): Promise<number> {
  try {
    const response = await fetch(imageUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get image size: ${response.statusText}`);
    }

    const contentLength = response.headers.get('Content-Length');
    return contentLength ? parseInt(contentLength, 10) : -1;
  } catch (error: any) {
    log(`Error getting image size: ${error.message}`, job);
    return -1;
  }
}

async function downloadImageToBuffer(
  imageUrl: string,
  job: Job
): Promise<Buffer> {
  log(`Downloading image from ${imageUrl}`, job);

  try {
    const response = await fetch(imageUrl, {
      headers: {
        // Add a User-Agent header to mimic a browser request
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
        // Add 'Accept' and 'Referer' headers
        Accept: '*/*',
        Referer: imageUrl,
      },
    });

    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText;
      log(
        `Failed to download image. Status: ${status}, StatusText: ${statusText}`,
        job
      );
      throw new Error(
        `Failed to download image: ${status} ${statusText}, ${imageUrl}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    log('Image downloaded successfully', job);
    return buffer;
  } catch (error: any) {
    log(`Error in downloadImage: ${error.message}`, job);
    throw error;
  }
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
    const transientErrorCodes = [
      'ENOTFOUND',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      // Add other transient error codes as needed
    ];
    const isTransientError =
      transientErrorCodes.includes(error.code) || error.status >= 500;
    const status = error?.status || error?.code || 'Unknown';
    log(
      `Error during operation: ${error.message}. Status: ${status}. Retries left: ${retries}`,
      job
    );
    if (retries > 0 && isTransientError) {
      log(`Retrying after ${delay} ms...`, job);
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
  // Validate URL format and check if it's from an allowed image domain
  try {
    const urlObj = new URL(imageUrl);
    const isAllowedImageDomain = [...imageDomains].some(
      (domain) =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowedImageDomain) {
      // log(`Skipping image from non-allowed domain: ${urlObj.hostname}`, job);
      return null;
    }

    // Convert imagedelivery URL before attempting to process
    if (imageRegex.test(imageUrl)) {
      imageUrl = convertImageDeliveryUrl(imageUrl);
    }
  } catch (e) {
    log(`Skipping invalid URL: ${imageUrl}`, job);
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
    // Check image size before downloading
    const imageSize = await getImageSize(imageUrl, job);
    const maxSizeInBytes = 25 * 1024 * 1024; // 25 MB limit
    if (imageSize > maxSizeInBytes) {
      log(`Image size ${imageSize} exceeds maximum allowed size`, job);
      return null;
    }

    log('Starting image download and processing', job);

    // Download image to buffer with retry logic
    const imageBuffer = await retryWithExponentialBackoff(
      async () => {
        return await downloadImageToBuffer(imageUrl, job);
      },
      job,
      3,
      1000
    );

    // Resize image using sharp
    const resizedImageBuffer = await sharp(imageBuffer)
      .resize({ width: 800 }) // Adjust width as needed
      .toBuffer();

    // Determine MIME type
    const image = sharp(resizedImageBuffer);
    const metadata = await image.metadata();
    const mimeType = `image/${metadata.format}`;

    // Write buffer to temp file

    await fsPromises.writeFile(
      tempFilePath,
      new Uint8Array(resizedImageBuffer)
    );

    // Upload temp file to Google
    log('Uploading image to Google AI Studio', job);
    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
      mimeType: mimeType,
      displayName: 'Image to analyze',
    });
    log('Image uploaded successfully', job);

    // Clean up temp file
    await fsPromises.unlink(tempFilePath);

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
