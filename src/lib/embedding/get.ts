import { RedisClientType } from 'redis';
import { OpenAI } from 'openai';
import { Job } from 'bullmq';
import {
  fetchUrlSummaries,
  saveUrlSummariesForCastHash,
} from '../url-summaries/attachments';
import { validTypes } from '../../types/job';

// Get embeddings from OpenAI
export const getEmbedding = async (
  redisClient: RedisClientType,
  openai: OpenAI,
  text: string,
  job: Job,
  type: (typeof validTypes)[number],
  externalId: string | null,
  urls?: string[]
): Promise<{ embedding: number[]; input: string; urlSummaries: string[] }> => {
  let input = text.replace('\n', ' ');

  let summaries: string[] = [];

  if (type === 'cast' && urls) {
    summaries = await saveUrlSummariesForCastHash(
      externalId,
      urls,
      redisClient,
      job
    );
  } else {
    summaries = await fetchUrlSummaries(redisClient, job, urls);
  }

  // Add URL context to input text
  if (summaries.length > 0) {
    input += ` [Contains attachments: ${summaries.join(', ')}]`;
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
