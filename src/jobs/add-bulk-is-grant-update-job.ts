import { Queue } from 'bullmq';
import { FastifyReply, FastifyRequest } from 'fastify';
import { IsGrantUpdateJobBody } from '../types/job';

export const handleBulkAddIsGrantUpdateJob = (queue: Queue) => {
  return async (
    req: FastifyRequest<{ Body: { jobs: IsGrantUpdateJobBody[] } }>,
    reply: FastifyReply
  ) => {
    const { jobs } = req.body;

    // Validate each job in the array
    for (const job of jobs) {
      const {
        grantId,
        castHash,
        castContent,
        grantDescription,
        parentFlowDescription,
        urls,
      } = job;

      const missingFields = [];
      if (!grantId) missingFields.push('grantId');
      if (!castHash) missingFields.push('castHash');
      if (!grantDescription) missingFields.push('grantDescription');
      if (!parentFlowDescription) missingFields.push('parentFlowDescription');

      if (missingFields.length > 0) {
        reply.status(400).send({
          error: `Missing required fields in one or more jobs: ${missingFields.join(
            ', '
          )}`,
        });
        return;
      }

      if (!castContent && urls.length === 0) {
        reply.status(400).send({
          error: 'Either castContent or urls must be provided',
        });
        return;
      }

      // Validate URLs array exists
      if (!Array.isArray(job.urls)) {
        reply.status(400).send({
          error: 'URLs must be an array in all jobs',
        });
        return;
      }
    }

    const jobName = `bulk-grant-update-${Date.now()}`;
    const job = await queue.add(jobName, jobs);

    reply.send({
      ok: true,
      jobName,
      jobId: job.id,
    });
  };
};