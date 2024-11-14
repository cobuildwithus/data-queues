import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { RedisClientType } from 'redis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

if (!ffmpegPath) {
  throw new Error('ffmpeg-static is required');
}

ffmpeg.setFfmpegPath(ffmpegPath);

if (!process.env.GOOGLE_AI_STUDIO_KEY) {
  throw new Error('GOOGLE_AI_STUDIO_KEY environment variable is required');
}

const VIDEO_DESCRIPTION_CACHE_PREFIX = 'svideo-aisdescription:';
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_AI_STUDIO_KEY);

async function getCachedVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string
): Promise<string | null> {
  console.log(`Checking cache for video description: ${videoUrl}`);
  const cached = await redisClient.get(
    `${VIDEO_DESCRIPTION_CACHE_PREFIX}${videoUrl}`
  );
  console.log(`Cache ${cached ? 'hit' : 'miss'} for video description`);
  return cached;
}

async function cacheVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string,
  description: string
): Promise<void> {
  console.log(`Caching video description for: ${videoUrl}`);
  await redisClient.set(
    `${VIDEO_DESCRIPTION_CACHE_PREFIX}${videoUrl}`,
    description
  );
  console.log('Video description cached successfully');
}

async function getLowestQualityStreamIndices(
  url: string
): Promise<{ videoIndex: number; audioIndex: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(url, (err, metadata) => {
      if (err) {
        return reject(err);
      }

      const streams = metadata.streams;
      if (!streams || streams.length === 0) {
        return reject(new Error('No streams found in HLS stream'));
      }

      // Filter video and audio streams
      const videoStreams = streams.filter((s) => s.codec_type === 'video');
      const audioStreams = streams.filter((s) => s.codec_type === 'audio');

      if (videoStreams.length === 0 || audioStreams.length === 0) {
        return reject(new Error('No video or audio streams found'));
      }

      // Sort video and audio streams by bitrate
      videoStreams.sort(
        (a, b) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
      );
      audioStreams.sort(
        (a, b) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
      );

      // Get the indices
      const lowestVideoIndex = videoStreams[0].index;
      const lowestAudioIndex = audioStreams[0].index;

      resolve({
        videoIndex: lowestVideoIndex,
        audioIndex: lowestAudioIndex,
      });
    });
  });
}

async function downloadLowQualityVideo(
  url: string,
  outputPath: string
): Promise<void> {
  console.log(`Downloading video from ${url} to ${outputPath}`);

  // Get the indices of the lowest quality video and audio streams
  const { videoIndex, audioIndex } = await getLowestQualityStreamIndices(url);
  console.log(
    `Selected video stream index: ${videoIndex}, audio stream index: ${audioIndex}`
  );

  return new Promise((resolve, reject) => {
    try {
      if (!ffmpegPath) {
        throw new Error(
          'ffmpeg-static is required but was not found in the system.'
        );
      }
      ffmpeg(url)
        .setFfmpegPath(ffmpegPath)
        .addInputOption('-protocol_whitelist', 'http,https,tcp,tls')
        .outputOptions('-c copy') // Copy streams without re-encoding
        // Map the selected video and audio streams
        .outputOptions('-map', `0:${videoIndex}`, '-map', `0:${audioIndex}`)
        .output(outputPath)
        .on('end', () => {
          console.log('Video download complete');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error downloading video:', err);
          reject(err);
        })
        .run();
    } catch (err) {
      console.error('Unexpected error during video download:', err);
      reject(err);
    }
  });
}

async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error?.status;
    if (retries > 0 && (status === 503 || status >= 500)) {
      console.log(`Retrying after ${delay} ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithExponentialBackoff(fn, retries - 1, delay * 2);
    } else {
      throw error;
    }
  }
}

/**
 * Analyzes a video from a URL and returns a description.
 * @param videoUrl - The URL of the video to analyze.
 * @param redisClient - Redis client for caching
 * @returns A promise that resolves to the description of the video.
 */
export async function describeVideo(
  videoUrl: string,
  redisClient: RedisClientType
): Promise<string | null> {
  console.log(`Starting video description process for: ${videoUrl}`);

  const cachedDescription = await getCachedVideoDescription(
    redisClient,
    videoUrl
  );
  if (cachedDescription) {
    console.log('Returning cached video description');
    return cachedDescription;
  }

  // Create unique directory name based on video URL hash
  const videoHash = crypto.createHash('md5').update(videoUrl).digest('hex');
  const videoDir = path.join(__dirname, videoHash);
  const localFilePath = path.join(videoDir, 'video.mp4');

  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    console.log('Starting video download and processing');
    // Download video using ffmpeg
    await downloadLowQualityVideo(videoUrl, localFilePath);

    // Upload video file to Google
    console.log('Uploading video to Google AI Studio');
    const uploadResponse = await fileManager.uploadFile(localFilePath, {
      mimeType: 'video/mp4',
      displayName: 'Video to analyze',
    });
    console.log('Video uploaded successfully');

    // Clean up local video file after upload
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      console.log('Deleted local video file after upload');
    }

    // Check file state until processing is complete
    console.log('Waiting for video processing to complete');
    let file = await fileManager.getFile(uploadResponse.file.name);
    const maxRetries = 30; // e.g., wait for up to 5 minutes
    let retries = 0;

    while (file.state === 'PROCESSING' && retries < maxRetries) {
      console.log('Video still processing, waiting 10 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      file = await fileManager.getFile(uploadResponse.file.name);
      retries++;
    }

    if (file.state === 'FAILED') {
      console.error('Video processing failed');
      throw new Error('Video processing failed');
    } else if (file.state === 'PROCESSING') {
      console.error('Video processing timed out');
      throw new Error('Video processing timed out');
    }

    console.log('Video processing completed successfully');

    // Generate description using Gemini Flash with retries
    console.log('Generating video description with Gemini Flash');
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
          text: `Please provide a detailed description of this video, focusing on all visible elements, their relationships, and the overall context.`,
        },
      ]);
    });

    const description = result.response.text();
    console.log('Generated description:', description);

    // Cache and delete the file after processing
    if (description) {
      console.log('Caching video description');
      await cacheVideoDescription(redisClient, videoUrl, description);
    }
    console.log('Cleaning up Google AI Studio file');
    await fileManager.deleteFile(uploadResponse.file.name);

    return description;
  } catch (error) {
    console.error('Error describing video:', error);
    return null;
  } finally {
    // Clean up local directory and files
    if (fs.existsSync(videoDir)) {
      console.log('Cleaning up local video directory');
      fs.rmSync(videoDir, { recursive: true, force: true });
    }
  }
}
