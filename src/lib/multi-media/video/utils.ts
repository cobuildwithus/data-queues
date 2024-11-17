import { Job } from 'bullmq';
import { log } from '../../queueLib';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { execSync } from 'child_process';

// Get paths to ffmpeg and ffprobe
export const ffmpegPath = execSync('which ffmpeg').toString().trim();
export const ffprobePath = execSync('which ffprobe').toString().trim();

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
      const ffmpegCommand = ffmpeg(url)
        .setFfmpegPath(ffmpegPath)
        .addInputOption('-protocol_whitelist', 'http,https,tcp,tls')
        .outputOptions('-c copy'); // Copy streams without re-encoding

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
      log('Unexpected error during video download:' + err, job);
      reject(err);
    }
  });
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

      if (videoStreams.length === 0) {
        return reject(new Error('No video streams found'));
      }

      // Sort video streams by bitrate to get lowest quality
      videoStreams.sort(
        (a, b) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
      );
      const lowestVideoIndex = videoStreams[0].index;

      // For audio, try to get lowest quality if available, otherwise -1
      let lowestAudioIndex = -1;
      if (audioStreams.length > 0) {
        audioStreams.sort(
          (a, b) => Number(a.bit_rate || 0) - Number(b.bit_rate || 0)
        );
        lowestAudioIndex = audioStreams[0].index;
      }

      resolve({
        videoIndex: lowestVideoIndex,
        audioIndex: lowestAudioIndex,
      });
    });
  });
}
