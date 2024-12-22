import { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { JobBody } from '../../types/job';
import { FarcasterAgentJobBody } from '../../types/job';
import { log } from '../../lib/helpers';

interface ProcessQueueJobsParams {
  job: Job;
  embeddingJobs: JobBody[];
  agentJobs: FarcasterAgentJobBody[];
  bulkEmbeddingsQueue: Queue<JobBody[]>;
  farcasterAgentQueue: Queue<FarcasterAgentJobBody>;
  results: { id: number; processed: boolean }[];
}

export async function processQueueJobs({
  job,
  embeddingJobs,
  agentJobs,
  bulkEmbeddingsQueue,
  farcasterAgentQueue,
  results,
}: ProcessQueueJobsParams) {
  const embeddingQueueJob = await bulkEmbeddingsQueue.add(
    `embed-story-${Date.now()}`,
    embeddingJobs
  );

  log(`Added ${embeddingJobs.length} embedding jobs to queue`, job);

  const agentQueueJobs = await Promise.all(
    agentJobs.map((agentJob) =>
      farcasterAgentQueue.add(`agent-story-${Date.now()}`, agentJob)
    )
  );

  log(`Added ${agentJobs.length} agent jobs to queue`, job);

  return {
    jobId: job.id,
    results,
    embeddingQueueJobId: embeddingQueueJob.id,
    agentQueueJobIds: agentQueueJobs.map((job) => job.id),
  };
}
