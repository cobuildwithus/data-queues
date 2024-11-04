import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { env } from './env';
import { Queue } from 'bullmq';
import { createQueue, setupQueueProcessor } from './queue';
import { JobBody } from './types/job';

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
    const { type, content, group, user } = req.body;

    if (!type || !content || !group.length || !user) {
      reply.status(400).send({ error: 'Missing required fields' });
      return;
    }

    if (!['grant', 'cast'].includes(type)) {
      reply
        .status(400)
        .send({ error: 'Type must be either "grant" or "cast"' });
      return;
    }

    if (!Array.isArray(group) || !Array.isArray(user)) {
      reply.status(400).send({ error: 'Group and user must be arrays' });
      return;
    }

    const jobId = `${type}-${Date.now()}`;
    await queue.add(jobId, { type, content, group, user });

    reply.send({
      ok: true,
      jobId,
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
          required: ['type', 'content', 'group', 'user'],
          properties: {
            type: {
              type: 'string',
              enum: ['grant', 'cast'],
            },
            content: { type: 'string' },
            group: {
              type: 'array',
              items: { type: 'string' },
            },
            user: {
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

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(
    `Server running on port ${env.PORT}. Send POST requests to ${env.RAILWAY_STATIC_URL}/add-job`
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
