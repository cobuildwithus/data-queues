import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.FLOWS_POSTGRES_URL as string,
});

export const flowsDb = drizzle(pool);
