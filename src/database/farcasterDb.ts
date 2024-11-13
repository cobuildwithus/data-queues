import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.FARCASTER_POSTGRES_URL as string,
});

export const farcasterDb = drizzle(pool);
