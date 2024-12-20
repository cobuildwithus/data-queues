import { Job } from 'bullmq';
import { log } from '../../helpers';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { execSync } from 'child_process';

// Get paths to ffmpeg and ffprobe
export const ffmpegPath = execSync('which ffmpeg').toString().trim();
export const ffprobePath = execSync('which ffprobe').toString().trim();

// Set the paths in fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

if (!ffmpegPath) {
  throw new Error('ffmpeg-static is required');
}

if (!ffprobePath) {
  throw new Error('ffprobe-static is required');
}

export async function downloadLowQualityVideo(
  url: string,
  outputPath: string,
  job: Job
): Promise<void> {
  log(`Downloading video from ${url} to ${outputPath}`, job);

  // Ensure the output directory exists
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.log('Output directory created:', outputDir);
  }

  return new Promise((resolve, reject) => {
    try {
      if (!ffmpegPath) {
        throw new Error(
          'ffmpeg-static is required but was not found in the system.'
        );
      }

      const ffmpegCommand = ffmpeg(url)
        .setFfmpegPath(ffmpegPath)
        .addInputOption('-protocol_whitelist', 'http,https,tcp,tls')
        .addInputOption(
          '-headers',
          `x-pinata-gateway-token: ${process.env.PINATA_GATEWAY_KEY}`
        );

      // First try to probe for streams
      ffmpeg.ffprobe(url, async (err, metadata) => {
        if (err) {
          // If probe fails, assume it's a direct MP4 file and try simple download
          log('Stream probe failed, attempting direct download', job);
          ffmpegCommand
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
          return;
        }

        // If probe succeeds, get lowest quality streams
        try {
          const { videoIndex, audioIndex } =
            await getLowestQualityStreamIndices(metadata);
          log(
            `Selected video stream index: ${videoIndex}, audio stream index: ${audioIndex}`,
            job
          );

          ffmpegCommand.outputOptions('-c copy'); // Copy streams without re-encoding

          // Map the selected video stream
          ffmpegCommand.outputOptions('-map', `0:${videoIndex}`);

          // Map the audio stream only if it exists
          if (audioIndex !== -1) {
            ffmpegCommand.outputOptions('-map', `0:${audioIndex}`);
          }

          ffmpegCommand
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
          reject(err);
        }
      });
    } catch (err) {
      log('Unexpected error during video download:' + err, job);
      reject(err);
    }
  });
}

async function getLowestQualityStreamIndices(
  metadata: any
): Promise<{ videoIndex: number; audioIndex: number }> {
  const streams = metadata.streams;
  if (!streams || streams.length === 0) {
    throw new Error('No streams found in video');
  }

  // Filter video and audio streams
  const videoStreams = streams.filter((s: any) => s.codec_type === 'video');
  const audioStreams = streams.filter((s: any) => s.codec_type === 'audio');

  if (videoStreams.length === 0) {
    throw new Error('No video streams found');
  }

  // Sort video streams by bitrate to get lowest quality
  videoStreams.sort(
    (a: any, b: any) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
  );
  const lowestVideoIndex = videoStreams[0].index;

  // For audio, try to get lowest quality if available, otherwise -1
  let lowestAudioIndex = -1;
  if (audioStreams.length > 0) {
    audioStreams.sort(
      (a: any, b: any) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
    );
    lowestAudioIndex = audioStreams[0].index;
  }

  return {
    videoIndex: lowestVideoIndex,
    audioIndex: lowestAudioIndex,
  };
}
