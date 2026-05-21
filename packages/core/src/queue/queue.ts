import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { CockpitDb } from '../db/db.js';
import { queueEntries } from '../db/schema.js';
import type {
  ChangeScope,
  QueueEntry,
  QueueEvent,
  QueueListener,
  QueuePushInput,
  TrackerSubjectKind,
} from './types.js';

export type Queue = {
  snapshot(): QueueEntry[];
  push(input: QueuePushInput): QueueEntry;
  ack(id: string): boolean;
  ackAll(): number;
  ackAllScope(scope: ChangeScope): number;
  on(listener: QueueListener): () => void;
};

export function createQueue({ db }: { db: CockpitDb }): Queue {
  const listeners = new Set<QueueListener>();

  const emit = (event: QueueEvent): void => {
    for (const fn of [...listeners]) fn(event);
  };

  const snapshot = (): QueueEntry[] => {
    const rows = db.select().from(queueEntries).orderBy(queueEntries.ts).all();
    return rows.map(toEntry);
  };

  const findByPath = (path: string): QueueEntry | undefined => {
    const row = db.select().from(queueEntries).where(eq(queueEntries.path, path)).get();
    return row ? toEntry(row) : undefined;
  };

  const push = (input: QueuePushInput): QueueEntry => {
    const ts = input.ts ?? Date.now();
    const existing = findByPath(input.path);
    const entry: QueueEntry = {
      id: randomUUID(),
      path: input.path,
      type: input.type,
      scope: input.scope,
      ts,
      ...(input.subject ? { subject: input.subject } : {}),
    };

    if (existing) {
      db.delete(queueEntries).where(eq(queueEntries.id, existing.id)).run();
    }
    db.insert(queueEntries)
      .values({
        id: entry.id,
        path: entry.path,
        type: entry.type,
        scope: entry.scope,
        ts: entry.ts,
        subjectKind: entry.subject?.kind ?? null,
        subjectTitle: entry.subject?.title ?? null,
      })
      .run();

    if (existing) {
      emit({ kind: 'replace', entry, replaces: existing.id });
    } else {
      emit({ kind: 'add', entry });
    }
    return entry;
  };

  const ack = (id: string): boolean => {
    const result = db.delete(queueEntries).where(eq(queueEntries.id, id)).run();
    const removed = result.changes > 0;
    if (removed) emit({ kind: 'ack', id });
    return removed;
  };

  const ackAll = (): number => {
    const result = db.delete(queueEntries).run();
    const removed = result.changes;
    if (removed > 0) emit({ kind: 'clear' });
    return removed;
  };

  const ackAllScope = (scope: ChangeScope): number => {
    const result = db.delete(queueEntries).where(eq(queueEntries.scope, scope)).run();
    const removed = result.changes;
    if (removed > 0) emit({ kind: 'clear', scope });
    return removed;
  };

  const on = (listener: QueueListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { snapshot, push, ack, ackAll, ackAllScope, on };
}

function toEntry(row: typeof queueEntries.$inferSelect): QueueEntry {
  const subject =
    row.subjectKind && row.subjectTitle
      ? { kind: row.subjectKind as TrackerSubjectKind, title: row.subjectTitle }
      : undefined;
  return {
    id: row.id,
    path: row.path,
    type: row.type as QueueEntry['type'],
    scope: row.scope as QueueEntry['scope'],
    ts: row.ts,
    ...(subject ? { subject } : {}),
  };
}
