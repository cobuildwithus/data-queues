import { db } from '../../db';
import { embeddings } from '../../schema';
import { and, eq } from 'drizzle-orm';

export const getBuilderProfile = async (fid: number) => {
  const profile = await db
    .select()
    .from(embeddings)
    .where(
      and(
        eq(embeddings.type, 'builder-profile'),
        eq(embeddings.externalId, fid.toString())
      )
    );

  return profile[0];
};
