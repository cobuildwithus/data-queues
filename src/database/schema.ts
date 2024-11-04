import {
  pgTable,
  text,
  timestamp,
  varchar,
  vector,
  integer,
} from 'drizzle-orm/pg-core';

export const embeddings = pgTable('embeddings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  type: varchar('type', { length: 12 }), // 'grant' or 'cast'
  version: integer('version').default(1),
  content: text('content'),
  contentHash: varchar('content_hash', { length: 64 }).unique(),
  embedding: vector('embedding', { dimensions: 1536 }), // Store as vector
  groups: text('groups').array(), // Array of group IDs eg: nouns
  users: text('users').array(), // Array of user addresses
});
