import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, { FastifyInstance } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { Queue } from 'bullmq';
import {
  createQueue,
  setupQueueProcessor,
  setupDeletionQueueProcessor,
} from './queue';
import { DeletionJobBody, JobBody, validTypes } from './types/job';
import 'dotenv/config';
import { handleAddEmbeddingJob } from './jobs/addEmbeddingJob';
import { handleDeleteEmbedding } from './jobs/deleteEmbedding';

const setupQueue = async () => {
  const embeddingsQueue = createQueue<JobBody>('EmbeddingsQueue');
  const deletionQueue = createQueue<DeletionJobBody>('DeletionQueue');

  await setupQueueProcessor<JobBody>(embeddingsQueue.name);
  await setupDeletionQueueProcessor(deletionQueue.name);

  return { embeddingsQueue, deletionQueue };
};

const setupBullBoard = (server: FastifyInstance, queues: Queue[]) => {
  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });
  serverAdapter.setBasePath('/');
  server.register(serverAdapter.registerPlugin(), {
    prefix: '/',
    basePath: '/',
  });
};

const setupServer = (queues: {
  embeddingsQueue: Queue;
  deletionQueue: Queue;
}) => {
  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  setupBullBoard(server, [queues.embeddingsQueue, queues.deletionQueue]);

  server.post(
    '/add-job',
    {
      schema: {
        body: {
          type: 'object',
          required: [
            'type',
            'content',
            'groups',
            'users',
            'tags',
            'externalId',
          ],
          properties: {
            type: {
              type: 'string',
              enum: validTypes,
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
            externalId: { type: 'string' },
          },
        },
      },
    },
    handleAddEmbeddingJob(queues.embeddingsQueue)
  );

  server.post(
    '/delete-embedding',
    {
      schema: {
        body: {
          type: 'object',
          required: ['contentHash', 'type'],
          properties: {
            contentHash: { type: 'string' },
            type: {
              type: 'string',
              enum: validTypes,
            },
          },
        },
      },
    },
    handleDeleteEmbedding(queues.deletionQueue)
  );

  server.setErrorHandler((error, request, reply) => {
    console.error('Request body:', JSON.stringify(request.body, null, 2));
    console.error('Validation error details:', error);
    console.error('Valid types are:', validTypes);
    reply.status(error.statusCode || 500).send(error);
  });

  return server;
};

const run = async () => {
  const queues = await setupQueue();
  const server = setupServer(queues);

  await server.listen({ port: Number(process.env.PORT), host: '0.0.0.0' });
  console.log(
    `Server running on port ${process.env.PORT}. POST requests to ${process.env.RAILWAY_STATIC_URL}/add-job`
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
