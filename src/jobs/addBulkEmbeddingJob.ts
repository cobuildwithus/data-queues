import { Queue } from 'bullmq';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JobBody, validTypes } from '../types/job';

export const handleBulkAddEmbeddingJob = (queue: Queue) => {
  return async (
    req: FastifyRequest<{ Body: { jobs: JobBody[] } }>,
    reply: FastifyReply
  ) => {
    const { jobs } = req.body;

    // Validate each job in the array
    for (const job of jobs) {
      const { type, content, groups, users, tags, externalId } = job;

      if (!type || !content || !externalId) {
        reply.status(400).send({
          error: 'Missing required fields in one or more jobs',
        });
        return;
      }

      if (!validTypes.includes(type)) {
        reply.status(400).send({
          error: `Type must be one of: ${validTypes.join(', ')}`,
        });
        return;
      }

      if (
        !Array.isArray(groups) ||
        !Array.isArray(users) ||
        !Array.isArray(tags)
      ) {
        reply.status(400).send({
          error: 'Groups, users, and tags must be arrays in all jobs',
        });
        return;
      }
    }

    const jobName = `bulk-embedding-${Date.now()}`;
    const job = await queue.add(jobName, jobs);

    reply.send({
      ok: true,
      jobName,
      jobId: job.id,
    });
  };
};
