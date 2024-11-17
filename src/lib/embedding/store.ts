import { db } from '../../database/db';
import { embeddings } from '../../database/schema';
import { JobBody } from '../../types/job';
import { EMBEDDING_CACHE_VERSION } from './cache';

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
      rawContent: job.rawContent,
      url_summaries: urlSummaries,
      urls: job.urls,
      contentHash: contentHash,
      embedding: embedding,
      version: EMBEDDING_CACHE_VERSION,
      groups: Array.from(
        new Set(job.groups.map((group) => group.toLowerCase()))
      ),
      users: Array.from(new Set(job.users.map((user) => user.toLowerCase()))),
      tags: Array.from(new Set(job.tags.map((tag) => tag.toLowerCase()))),
      externalId: job.externalId,
      externalUrl: job.externalUrl,
    })
    .onConflictDoUpdate({
      target: [embeddings.contentHash],
      set: {
        embedding: embedding,
        version: EMBEDDING_CACHE_VERSION,
        url_summaries: urlSummaries,
      },
    });
};
