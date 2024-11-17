import { Job } from 'bullmq';
import { log } from '../../queueLib';
import { imageDomains } from '../domains';
import sharp from 'sharp';
import { retryWithExponentialBackoff } from '../../retry/retry-fetch';

export async function downloadImageToBuffer(
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

export function convertFarcasterImageUrl(imageUrl: string): string {
  return imageUrl
    .replace('imagedelivery.net', 'wrpcd.net/cdn-cgi/imagedelivery')
    .replace(/\/([^/]+)\/original$/, (_, id) => `/${id}/rectcontain3`);
}

// farcaster image delivery regex
const farcasterImageRegex =
  /(imagedelivery\/BXluQx4ige9GuW0Ia56BHw|BXluQx4ige9GuW0Ia56BHw)/;

export function getImageUrl(imageUrl: string, job: Job): string | null {
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
    if (farcasterImageRegex.test(imageUrl) || imageUrl.includes('wrpcd.net')) {
      return convertFarcasterImageUrl(imageUrl);
    }

    return imageUrl;
  } catch (e) {
    log(`Skipping invalid URL: ${imageUrl}`, job);
    return null;
  }
}

export async function downloadAndProcessImage(imageUrl: string, job: Job) {
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
    .resize({ width: 800 })
    .jpeg({ quality: 70 })
    .toBuffer();

  // Determine MIME type
  const image = sharp(resizedImageBuffer);
  const metadata = await image.metadata();
  const mimeType = `image/${metadata.format}`;

  // Check image size using sharp
  const imageSize = resizedImageBuffer.byteLength;
  const maxSizeInBytes = 25 * 1024 * 1024; // 25 MB limit
  if (imageSize > maxSizeInBytes) {
    log(`Image size ${imageSize} exceeds maximum allowed size`, job);
    return null;
  }

  return {
    buffer: resizedImageBuffer,
    mimeType,
  };
}
