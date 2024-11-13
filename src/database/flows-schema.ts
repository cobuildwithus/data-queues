import { text, timestamp, integer, pgSchema } from 'drizzle-orm/pg-core';

// Define the schema
const webSchema = pgSchema('web');

export const derivedData = webSchema.table('DerivedData', {
  id: text('id').primaryKey(),
  grantId: text('grantId').unique(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  minimumSalary: integer('minimumSalary'),
  template: text('template'),
  lastBuilderUpdate: timestamp('lastBuilderUpdate'),
});
