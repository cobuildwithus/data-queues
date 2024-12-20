import { Job } from 'bullmq';
import { getAndSaveUrlSummaries } from '../url-summaries/attachments';
import { RedisClientType } from 'redis';
import { CastForAgent } from '../../database/queries/casts/casts-for-agent';
import { insertMentionsIntoText } from '../mentions/add-mentions';

export function getEmbedUrls(embeds: string | null): string[] {
  if (!embeds) return [];
  return JSON.parse(embeds).map((embed: { url: string }) => embed.url);
}

function generateCastUrl(
  fname: string | undefined,
  hash: Buffer | null
): string {
  return `https://warpcast.com/${fname}/0x${hash?.toString('hex')}`;
}

export async function formatCastForPrompt(
  cast: CastForAgent,
  redisClient: RedisClientType,
  job: Job
): Promise<{
  mainCastText: string;
  rootCastText: string;
  otherRepliesText: string;
}> {
  if (!cast)
    return { mainCastText: '', rootCastText: '', otherRepliesText: '' };

  const embedSummaries = await getAndSaveUrlSummaries(
    cast.embeds,
    cast.embedSummaries,
    cast.id,
    redisClient,
    job
  );

  const embedUrls = getEmbedUrls(cast.embeds);
  if (!cast.profile?.fname) {
    throw new Error('Cast profile is required');
  }

  let castText = cast.text;
  if (cast.mentionsPositionsArray && cast.mentionedFids && castText) {
    castText = insertMentionsIntoText(
      castText,
      cast.mentionsPositionsArray,
      cast.mentionedFids,
      cast.mentionedFnames || cast.mentionedFids.map((fid) => fid.toString())
    );
  }

  const mainCastText = formatMainCastSection(
    cast.timestamp,
    castText,
    cast.profile?.fname,
    cast.hash,
    embedSummaries,
    embedUrls,
    cast.parentCast
  );

  const rootCastText = cast.rootCast ? formatRootSection(cast.rootCast) : '';
  const otherRepliesText = cast.otherReplies?.length
    ? formatRelatedSection(cast.otherReplies)
    : '';

  return {
    mainCastText,
    rootCastText,
    otherRepliesText,
  };
}

function formatMainCastSection(
  timestamp: Date | null,
  text: string | null,
  fname: string | undefined,
  hash: Buffer | null,
  embedSummaries: string[],
  embedUrls: string[],
  parentCast: NonNullable<CastForAgent>['parentCast']
): string {
  if (!timestamp) return '';

  const contentText = text ? `CONTENT: ${text}` : '';
  const castUrl = generateCastUrl(fname, hash);
  const attachments = embedSummaries.length
    ? `ATTACHMENTS: ${embedSummaries.join(' | ')}`
    : '';
  const attachmentUrls = embedUrls.length
    ? `ATTACHMENT_URLS: ${embedUrls.join(' | ')}`
    : '';

  const parentSection = parentCast ? formatParentSection(parentCast) : '';

  return `MAIN_CAST:
AUTHOR: ${fname || 'Unknown'}
TIMESTAMP: ${new Date(timestamp).toISOString()}
${contentText}
CAST_URL: ${castUrl}
${attachments}
${attachmentUrls}
${parentSection}`;
}

function formatParentSection(
  parentCast: NonNullable<CastForAgent>['parentCast']
): string {
  if (!parentCast?.text) return '';

  let parentText = parentCast.text;
  if (parentCast.mentionsPositionsArray && parentCast.mentionedFids) {
    parentText = insertMentionsIntoText(
      parentText,
      parentCast.mentionsPositionsArray,
      parentCast.mentionedFids,
      parentCast.mentionedFnames ||
        parentCast.mentionedFids.map((fid) => fid.toString())
    );
  }

  return `PARENT_CAST:
AUTHOR: ${parentCast.fname || 'Unknown'} (fid: ${parentCast.fid})
CONTENT: ${parentText}
${parentCast.embedSummaries?.length ? `ATTACHMENTS: ${parentCast.embedSummaries.join(' | ')}` : ''}`;
}

function formatRootSection(
  rootCast: NonNullable<CastForAgent>['rootCast']
): string {
  if (!rootCast?.text) return '';

  let rootText = rootCast.text;
  if (rootCast.mentionsPositionsArray && rootCast.mentionedFids) {
    rootText = insertMentionsIntoText(
      rootText,
      rootCast.mentionsPositionsArray,
      rootCast.mentionedFids,
      rootCast.mentionedFnames ||
        rootCast.mentionedFids.map((fid) => fid.toString())
    );
  }

  return `ROOT_CAST:
AUTHOR: ${rootCast.fname || 'Unknown'} (fid: ${rootCast.fid})
CONTENT: ${rootText}
${rootCast.embedSummaries?.length ? `ATTACHMENTS: ${rootCast.embedSummaries.join(' | ')}` : ''}`;
}

function formatRelatedSection(
  relatedCasts: NonNullable<CastForAgent>['otherReplies']
): string {
  if (!relatedCasts?.length) return '';

  const formattedCasts = relatedCasts
    .filter((cast) => cast.text)
    .map((cast) => {
      let text = cast.text;
      if (cast.mentionsPositionsArray && cast.mentionedFids) {
        text = insertMentionsIntoText(
          text || '',
          cast.mentionsPositionsArray,
          cast.mentionedFids,
          cast.mentionedFnames ||
            cast.mentionedFids.map((fid) => fid.toString())
        );
      }
      return `- ${cast.fname || 'Unknown'}: ${text}`;
    })
    .join('\n');

  return `OTHER_REPLIES:\n${formattedCasts}`;
}

export function getCastHash(castHash: string): Buffer {
  return Buffer.from(castHash.replace('0x', ''), 'hex');
}
