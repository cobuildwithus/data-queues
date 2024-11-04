import { envsafe, port, str } from 'envsafe';

export const env = envsafe({
  OPENAI_API_KEY: str(),
  REDISHOST: str({
    devDefault: 'localhost',
  }),
  REDISPORT: port({
    devDefault: 6379,
  }),
  REDISUSER: str({
    devDefault: 'default',
    allowEmpty: true,
  }),
  REDISPASSWORD: str({
    devDefault: '',
    allowEmpty: true,
  }),
  PORT: port({
    devDefault: 4000,
  }),
  RAILWAY_STATIC_URL: str({
    devDefault: 'http://localhost:4000',
  }),
});
