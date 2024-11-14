import ffmpeg from 'fluent-ffmpeg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { RedisClientType } from 'redis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Job } from 'bullmq';
import { log } from '../queueLib';
import { execSync } from 'child_process';

// Get paths to ffmpeg and ffprobe
const ffmpegPath = execSync('which ffmpeg').toString().trim();
const ffprobePath = execSync('which ffprobe').toString().trim();

console.log('ffmpeg path:', ffmpegPath);
console.log('ffprobe path:', ffprobePath);

// Set the paths in fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

if (!ffmpegPath) {
  throw new Error('ffmpeg-static is required');
}

if (!ffprobePath) {
  throw new Error('ffprobe-static is required');
}

if (!process.env.GOOGLE_AI_STUDIO_KEY) {
  throw new Error('GOOGLE_AI_STUDIO_KEY environment variable is required');
}

const VIDEO_DESCRIPTION_CACHE_PREFIX = 'ai-studio-video-description:';
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_AI_STUDIO_KEY);

async function getCachedVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string,
  job: Job
): Promise<string | null> {
  log(`Checking cache for video description: ${videoUrl}`, job);
  const cached = await redisClient.get(
    `${VIDEO_DESCRIPTION_CACHE_PREFIX}${videoUrl}`
  );
  log(`Cache ${cached ? 'hit' : 'miss'} for video description`, job);
  return cached;
}

async function cacheVideoDescription(
  redisClient: RedisClientType,
  videoUrl: string,
  description: string,
  job: Job
): Promise<void> {
  log(`Caching video description for: ${videoUrl}`, job);
  await redisClient.set(
    `${VIDEO_DESCRIPTION_CACHE_PREFIX}${videoUrl}`,
    description
  );
  log('Video description cached successfully', job);
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
  outputPath: string,
  job: Job
): Promise<void> {
  log(`Downloading video from ${url} to ${outputPath}`, job);

  // Get the indices of the lowest quality video and audio streams
  const { videoIndex, audioIndex } = await getLowestQualityStreamIndices(url);
  log(
    `Selected video stream index: ${videoIndex}, audio stream index: ${audioIndex}`,
    job
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
          log('Video download complete', job);
          resolve();
        })
        .on('error', (err) => {
          log('Error downloading video:' + err, job);
          reject(err);
        })
        .run();
    } catch (err) {
      log('Unexpected error during video download:' + err, job);
      reject(err);
    }
  });
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

/**
 * Analyzes a video from a URL and returns a description.
 * @param videoUrl - The URL of the video to analyze.
 * @param redisClient - Redis client for caching
 * @returns A promise that resolves to the description of the video.
 */
export async function describeVideo(
  videoUrl: string,
  redisClient: RedisClientType,
  job: Job
): Promise<string | null> {
  log(`Starting video description process for: ${videoUrl}`, job);

  const cachedDescription = await getCachedVideoDescription(
    redisClient,
    videoUrl,
    job
  );
  if (cachedDescription) {
    log('Returning cached video description', job);
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

    log('Starting video download and processing', job);
    // Download video using ffmpeg
    await downloadLowQualityVideo(videoUrl, localFilePath, job);

    // Upload video file to Google
    log('Uploading video to Google AI Studio', job);
    const uploadResponse = await fileManager.uploadFile(localFilePath, {
      mimeType: 'video/mp4',
      displayName: 'Video to analyze',
    });
    log('Video uploaded successfully', job);

    // Clean up local video file after upload
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
      log('Deleted local video file after upload', job);
    }

    // Check file state until processing is complete
    log('Waiting for video processing to complete', job);
    let file = await fileManager.getFile(uploadResponse.file.name);
    const maxRetries = 30; // e.g., wait for up to 5 minutes
    let retries = 0;

    while (file.state === 'PROCESSING' && retries < maxRetries) {
      log('Video still processing, waiting 10 seconds...', job);
      await new Promise((resolve) => setTimeout(resolve, 10000));
      file = await fileManager.getFile(uploadResponse.file.name);
      retries++;
    }

    if (file.state === 'FAILED') {
      log('Video processing failed', job);
      throw new Error('Video processing failed');
    } else if (file.state === 'PROCESSING') {
      log('Video processing timed out', job);
      throw new Error('Video processing timed out');
    }

    log('Video processing completed successfully', job);

    // Generate description using Gemini Flash with retries
    log('Generating video description with Gemini Flash', job);
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
    }, job);

    const description = result.response.text();
    log('Generated description:' + description, job);

    // Cache and delete the file after processing
    if (description) {
      log('Caching video description', job);
      await cacheVideoDescription(redisClient, videoUrl, description, job);
    }
    log('Cleaning up Google AI Studio file', job);
    await fileManager.deleteFile(uploadResponse.file.name);

    return description;
  } catch (error) {
    log('Error describing video:' + error, job);
    return null;
  } finally {
    // Clean up local directory and files
    if (fs.existsSync(videoDir)) {
      log('Cleaning up local video directory', job);
      fs.rmSync(videoDir, { recursive: true, force: true });
    }
  }
}
