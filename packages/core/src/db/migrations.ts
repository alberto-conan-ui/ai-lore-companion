import type Database from 'better-sqlite3';

type Migration = {
  name: string;
  sql: string;
};

const MIGRATIONS: readonly Migration[] = [
  {
    name: '0000_init',
    sql: `
      CREATE TABLE IF NOT EXISTS queue_entries (
        id    TEXT PRIMARY KEY NOT NULL,
        path  TEXT NOT NULL UNIQUE,
        type  TEXT NOT NULL,
        scope TEXT NOT NULL,
        ts    INTEGER NOT NULL
      );
    `,
  },
  {
    name: '0001_tracker_subject',
    sql: `
      ALTER TABLE queue_entries ADD COLUMN subject_kind  TEXT;
      ALTER TABLE queue_entries ADD COLUMN subject_title TEXT;
    `,
  },
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const seen = new Set(
    sqlite
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const applyOne = sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (seen.has(migration.name)) continue;
    const tx = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      applyOne.run(migration.name, Date.now());
    });
    tx();
  }
}
