import { FarcasterCast } from '../../database/farcaster-schema';
import { safeTrim } from '../../lib/builders/utils';

export const getUniqueRootParentUrls = (casts: FarcasterCast[]): string[] => {
  return Array.from(
    new Set(
      casts
        .filter(
          (cast) => cast.parentHash === null && cast.rootParentUrl !== null
        )
        .map((cast) => cast.rootParentUrl)
        .filter(
          (url): url is string =>
            url !== undefined &&
            url !== null &&
            safeTrim(url) !== '' &&
            safeTrim(url) !== '""'
        )
    )
  );
};
