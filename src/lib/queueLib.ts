import { Job } from 'bullmq';
import { JobBody } from '../types/job';
import { db } from '../database/db';
import { embeddings } from '../database/schema';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { describeImage } from './image/describeImage';

const version = 20;
export const contentHashPrefix = `v${version}-content:`;

// Helper to update job progress
export const updateJobProgress = async (
  job: Job,
  phase: string,
  progress: number
) => {
  await job.updateProgress({
    phase,
    progress,
  });
};

// Log function that console.logs and job logs
export const log = (message: string, job: Job) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(message);
  }
  job.log(message);
};

// Get content hash
export const getContentHash = async (
  content: string,
  type: string,
  hashSuffix?: string,
  urls?: string[]
) => {
  const contentHash = createHash('sha256')
    .update(`${type}-${content}-${hashSuffix ?? ''}-${urls?.join(',') ?? ''}`)
    .digest('hex');
  return contentHash;
};

// Store job ID in Redis
export const storeJobId = async (
  redisClient: any,
  jobId: string,
  contentHash: string
) => {
  await redisClient.set(`${contentHashPrefix}${contentHash}`, jobId);
};

// Get embeddings from OpenAI
export const getEmbedding = async (
  openai: OpenAI,
  text: string,
  urls?: string[]
): Promise<{ embedding: number[]; input: string; urlSummaries: string[] }> => {
  let input = text.replace('\n', ' ');
  const summaries: string[] = [];

  if (urls && urls.length > 0) {
    let type: 'image' | 'video' | null = null;

    // Process each URL
    for (const url of urls) {
      if (!url) continue;

      // Determine type and collect URLs
      if (url.includes('m3u8')) {
        type = 'video';
      } else {
        type = 'image';
      }

      if (type === 'image') {
        const summary = await describeImage(url);
        // Only add non-empty summaries that aren't just empty quotes
        if (summary && summary.trim() !== '""' && summary.trim() !== '') {
          summaries.push(summary);
        }
      }
    }

    // Add URL context to input text
    if (summaries.length > 0) {
      input += ` [Contains ${type}: ${summaries.join(', ')}]`;
    }
  }

  if (summaries.length > 0) {
    console.log({ input, summaries, text, urls });
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: input,
  });

  return {
    embedding: response.data[0].embedding,
    input,
    urlSummaries: summaries,
  };
};

// Store embedding in database
export const storeEmbedding = async (
  embedding: number[],
  input: string,
  urlSummaries: string[],
  job: JobBody,
  contentHash: string
) => {
  await db
    .insert(embeddings)
    .values({
      id: crypto.randomUUID(),
      type: job.type,
      content: input,
      url_summaries: urlSummaries,
      urls: job.urls,
      contentHash: contentHash,
      embedding: embedding,
      version: version,
      groups: [...new Set(job.groups.map((group) => group.toLowerCase()))],
      users: [...new Set(job.users.map((user) => user.toLowerCase()))],
      tags: [...new Set(job.tags.map((tag) => tag.toLowerCase()))],
      externalId: job.externalId,
    })
    .onConflictDoNothing();
};

// Check if content hash exists
export const handleContentHash = async (redisClient: any, job: JobBody) => {
  const contentHash = await getContentHash(
    job.content,
    job.type,
    job.hashSuffix,
    job.urls
  );
  const existingJobId = await redisClient.get(
    `${contentHashPrefix}${contentHash}`
  );

  if (existingJobId) {
    return { exists: true, jobId: existingJobId, contentHash };
  }

  return { exists: false, jobId: null, contentHash };
};
