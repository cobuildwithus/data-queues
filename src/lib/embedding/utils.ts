import { createHash } from 'crypto';

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
