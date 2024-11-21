import { text, pgTable, primaryKey } from 'drizzle-orm/pg-core';

// Define the schema

export const tokenMetadata = pgTable(
  'token_metadata',
  {
    contractAddress: text('contract_address').notNull(),
    tokenId: text('token_id').notNull(),
    url: text('url').notNull(),
    platform: text('platform').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    image: text('image').notNull(),
    animationUrl: text('animation_url').notNull(),
    contentMime: text('content_mime').notNull(),
    contentUri: text('content_uri').notNull(),
    contentAiDescription: text('content_ai_description'),
    creatorRewardsRecipient: text('creator_rewards_recipient'),
    owner: text('owner'),
    ownerUsername: text('owner_username'),
    creatorRewardsRecipientUsername: text('creator_rewards_recipient_username'),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.contractAddress, table.tokenId] }),
    };
  }
);

export type TokenMetadata = typeof tokenMetadata.$inferSelect;
