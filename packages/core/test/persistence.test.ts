import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createQueue, openDb } from '../src/index.js';

function makeTempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-persist-'));
  return {
    path: join(dir, 'cockpit.sqlite'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('queue entries survive across process-like restart', () => {
  const { path, cleanup } = makeTempDbPath();
  try {
    const first = openDb(path);
    const q1 = createQueue({ db: first.db });
    q1.push({ path: 'src/a.ts', type: 'add', scope: 'payload', ts: 100 });
    q1.push({ path: 'src/b.ts', type: 'change', scope: 'payload', ts: 200 });
    q1.push({
      path: '.ai-lore-x/memory/status/status.index.md',
      type: 'change',
      scope: 'lore',
      ts: 300,
    });
    first.close();

    const second = openDb(path);
    const q2 = createQueue({ db: second.db });
    const snap = q2.snapshot();
    assert.equal(snap.length, 3);
    assert.deepEqual(
      snap.map((e) => e.path),
      ['src/a.ts', 'src/b.ts', '.ai-lore-x/memory/status/status.index.md'],
    );
    second.close();
  } finally {
    cleanup();
  }
});

test('ack persists across restart — removed entries do not come back', () => {
  const { path, cleanup } = makeTempDbPath();
  try {
    const first = openDb(path);
    const q1 = createQueue({ db: first.db });
    const a = q1.push({ path: 'src/a.ts', type: 'add', scope: 'payload' });
    q1.push({ path: 'src/b.ts', type: 'add', scope: 'payload' });
    q1.ack(a.id);
    first.close();

    const second = openDb(path);
    const q2 = createQueue({ db: second.db });
    const snap = q2.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.path, 'src/b.ts');
    second.close();
  } finally {
    cleanup();
  }
});

test('migrations are idempotent — re-opening an existing DB does not error', () => {
  const { path, cleanup } = makeTempDbPath();
  try {
    openDb(path).close();
    openDb(path).close();
    const third = openDb(path);
    const rows = third.sqlite.prepare('SELECT name FROM _migrations').all();
    assert.equal(rows.length, 2);
    third.close();
  } finally {
    cleanup();
  }
});

test('tracker-review subject round-trips through persistence', () => {
  const { path, cleanup } = makeTempDbPath();
  try {
    const first = openDb(path);
    const q1 = createQueue({ db: first.db });
    q1.push({
      path: '.ai-lore-x/memory/action-tree/foo/B-phase.phase.md',
      type: 'tracker-review',
      scope: 'lore',
      ts: 500,
      subject: { kind: 'at-node', title: 'Phase B — core/ module' },
    });
    first.close();

    const second = openDb(path);
    const q2 = createQueue({ db: second.db });
    const snap = q2.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.type, 'tracker-review');
    assert.deepEqual(snap[0]?.subject, { kind: 'at-node', title: 'Phase B — core/ module' });
    second.close();
  } finally {
    cleanup();
  }
});
