import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './migrations.js';
import * as schema from './schema.js';

export type CockpitDb = ReturnType<typeof drizzle<typeof schema>>;

export type DbHandle = {
  db: CockpitDb;
  sqlite: Database.Database;
  close: () => void;
};

/**
 * Open the cockpit SQLite database at the given absolute path, applying
 * migrations idempotently. The caller (app/) is responsible for resolving
 * the path — core/ never touches `app.getPath`.
 */
export function openDb(dbPath: string): DbHandle {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
