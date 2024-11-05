import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { Queue } from 'bullmq';
import { createQueue, setupQueueProcessor } from './queue';
import { JobBody, validTypes } from './types/job';
import 'dotenv/config';

const setupQueue = async () => {
  const embeddingsQueue = createQueue<JobBody>('EmbeddingsQueue');
  await setupQueueProcessor<JobBody>(embeddingsQueue.name);
  return embeddingsQueue;
};

const setupBullBoard = (server: FastifyInstance, queue: Queue) => {
  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });
  serverAdapter.setBasePath('/');
  server.register(serverAdapter.registerPlugin(), {
    prefix: '/',
    basePath: '/',
  });
};

const handleAddJob = (queue: Queue) => {
  return async (
    req: FastifyRequest<{ Body: JobBody }>,
    reply: FastifyReply
  ) => {
    const { type, content, groups, users, tags } = req.body;

    if (!type || !content || !groups.length || !users.length || !tags) {
      reply.status(400).send({ error: 'Missing required fields' });
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
      reply
        .status(400)
        .send({ error: 'Groups, users, and tags must be arrays' });
      return;
    }

    const jobName = `${type}-${Date.now()}`;
    const job = await queue.add(jobName, {
      type,
      content,
      groups,
      users,
      tags,
    });

    reply.send({
      ok: true,
      jobName,
      jobId: job.id,
    });
  };
};

const setupServer = (queue: Queue) => {
  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  setupBullBoard(server, queue);

  server.post(
    '/add-job',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'content', 'groups', 'users', 'tags'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'grant',
                'cast',
                'grant-application',
                'flow',
                'dispute',
                'draft',
              ],
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            content: { type: 'string' },
            groups: {
              type: 'array',
              items: { type: 'string' },
            },
            users: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    handleAddJob(queue)
  );

  return server;
};

const run = async () => {
  const embeddingsQueue = await setupQueue();
  const server = setupServer(embeddingsQueue);

  await server.listen({ port: Number(process.env.PORT), host: '0.0.0.0' });
  console.log(
    `Server running on port ${process.env.PORT}. POST requests to ${process.env.RAILWAY_STATIC_URL}/add-job`
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
