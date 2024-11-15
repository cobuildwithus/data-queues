import { Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { RedisClientType } from 'redis';
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

async function downloadImage(
  imageUrl: string,
  outputPath: string,
  job: Job
): Promise<void> {
  log(`Downloading image from ${imageUrl} to ${outputPath}`, job);

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

    const buffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    await fsPromises.writeFile(outputPath, uint8Array);
    log('Image downloaded successfully', job);
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
    const isNetworkError =
      error.code === 'ENOTFOUND' || error.code === 'ECONNRESET';
    const status = error?.status || error?.code || 'Unknown';
    log(
      `Error during operation: ${error.message}. Status: ${status}. Retries left: ${retries}`,
      job
    );
    if (retries > 0 && (isNetworkError || status >= 500)) {
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
    const isAllowedImageDomain = imageDomains.some((domain) =>
      urlObj.hostname.endsWith(domain)
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
      await fsPromises.unlink(localFilePath);
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

    // log(`Result from generateContent: ${JSON.stringify(result, null, 2)}`, job);

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
      await fsPromises.rm(imageDir, { recursive: true, force: true });
      log('Cleaned up local image directory', job);
    }
  }
}
'