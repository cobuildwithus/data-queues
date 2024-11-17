import { Job } from 'bullmq';
import { getGrantUpdateCastPrompt } from '../prompts/grant-update-cast';
import { log } from '../queueLib';

export function getMessageContent(
  data: {
    castContent?: string;
    grantId: string;
    grantDescription: string;
    parentFlowDescription: string;
    castHash: string;
  },
  summaries: string[],
  job: Job
): string {
  const content = getGrantUpdateCastPrompt({
    grantId: data.grantId,
    grantDescription: data.grantDescription,
    parentFlowDescription: data.parentFlowDescription,
    attachmentSummaries: summaries,
  });

  log(content, job);

  return content;
}
