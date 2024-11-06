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

const validateApiKey = (request: any, reply: any, done: any) => {
  console.log('Validating API key');
  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    console.log('Invalid API key');
    reply.code(401).send({ error: 'Invalid or missing API key' });
    return;
  }
  console.log('Valid API key');
  done();
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
      preHandler: validateApiKey,
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
            content: { type: 'string' },
            groups: {
              type: 'array',
              items: { type: 'string' },
            },
            users: {
              type: 'array',
              items: { type: 'string' },
            },
            tags: {
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
      preHandler: validateApiKey,
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
    console.error('Error occurred while processing request:');
    console.error('Request body:', JSON.stringify(request.body, null, 2));
    console.error('Validation error details:', error);
    if (error.validation) {
      console.error('Validation failures:', error.validation);
      console.error(
        'Missing required fields:',
        error.validation
          .map((v: any) => v.params.missingProperty)
          .filter(Boolean)
      );
    }
    console.error('Valid types are:', validTypes);
    console.error('Stack trace:', error.stack);
    reply.status(error.statusCode || 500).send({
      error: error.message,
      validation: error.validation,
      validTypes,
      statusCode: error.statusCode || 500,
    });
  });

  return server;
};

const run = async () => {
  if (!process.env.API_KEY) {
    throw new Error('API_KEY environment variable is required');
  }

  const queues = await setupQueue();
  const server = setupServer(queues);

  await server.listen({ port: Number(process.env.PORT), host: '0.0.0.0' });
  console.log(
    `Server running on port ${process.env.PORT}. POST requests to ${process.env.RAILWAY_STATIC_URL}/add-job`
  );
};

run().catch((e) => {
  console.error('Application startup failed:');
  console.error(e);
  console.error('Stack trace:', e.stack);
  process.exit(1);
});
