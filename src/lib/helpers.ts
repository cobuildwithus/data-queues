import { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';

export const setupBullBoard = (server: FastifyInstance, queues: Queue[]) => {
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

export const validateApiKey = (request: any, reply: any, done: any) => {
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

export const handleError = (error: any, request: any, reply: any) => {
  console.error('Error occurred while processing request:');
  console.error('Request body:', JSON.stringify(request.body, null, 2));
  console.error('Validation error details:', error);
  if (error.validation) {
    console.error('Validation failures:', error.validation);
    console.error(
      'Missing required fields:',
      error.validation.map((v: any) => v.params.missingProperty).filter(Boolean)
    );
  }
  console.error('Valid types are:', error.validTypes);
  console.error('Stack trace:', error.stack);
  reply.status(error.statusCode || 500).send({
    error: error.message,
    validation: error.validation,
    validTypes: error.validTypes,
    statusCode: error.statusCode || 500,
  });
};
