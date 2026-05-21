import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const queueEntries = sqliteTable('queue_entries', {
    id: text('id').primaryKey(),
    path: text('path').notNull().unique(),
    type: text('type').notNull(),
    scope: text('scope').notNull(),
    ts: integer('ts').notNull(),
    subjectKind: text('subject_kind'),
    subjectTitle: text('subject_title'),
});
//# sourceMappingURL=schema.js.map