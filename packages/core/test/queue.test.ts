import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type QueueEvent, createQueue, openDb } from '../src/index.js';

function openMemoryDb(): ReturnType<typeof openDb> {
  return openDb(':memory:');
}

test('queue push emits add event and appears in snapshot', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const entry = queue.push({ path: 'src/foo.ts', type: 'change', scope: 'payload' });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'add');
    if (events[0]?.kind === 'add') {
      assert.equal(events[0].entry.id, entry.id);
    }

    const snap = queue.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.path, 'src/foo.ts');
  } finally {
    handle.close();
  }
});

test('queue dedups by path — new event replaces old entry', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const first = queue.push({ path: 'src/foo.ts', type: 'change', scope: 'payload', ts: 1 });
    const second = queue.push({ path: 'src/foo.ts', type: 'change', scope: 'payload', ts: 2 });

    assert.notEqual(first.id, second.id);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.kind, 'add');
    assert.equal(events[1]?.kind, 'replace');
    if (events[1]?.kind === 'replace') {
      assert.equal(events[1].replaces, first.id);
      assert.equal(events[1].entry.id, second.id);
    }

    const snap = queue.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.id, second.id);
    assert.equal(snap[0]?.ts, 2);
  } finally {
    handle.close();
  }
});

test('queue dismiss removes a single entry and emits dismiss event', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    const a = queue.push({ path: 'a.ts', type: 'add', scope: 'payload' });
    queue.push({ path: 'b.ts', type: 'add', scope: 'payload' });

    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const removed = queue.dismiss(a.id);
    assert.equal(removed, true);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'dismiss');
    if (events[0]?.kind === 'dismiss') {
      assert.equal(events[0].id, a.id);
    }

    const snap = queue.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.path, 'b.ts');
  } finally {
    handle.close();
  }
});

test('queue dismissAll clears every entry and emits clear once', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    queue.push({ path: 'a.ts', type: 'add', scope: 'payload' });
    queue.push({ path: 'b.ts', type: 'add', scope: 'payload' });
    queue.push({ path: 'c.ts', type: 'add', scope: 'lore' });

    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const cleared = queue.dismissAll();
    assert.equal(cleared, 3);
    assert.equal(queue.snapshot().length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'clear');
  } finally {
    handle.close();
  }
});

test('queue dismissAllScope clears only the named scope and emits a scoped clear', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    queue.push({ path: 'a.ts', type: 'add', scope: 'payload' });
    queue.push({ path: 'b.ts', type: 'add', scope: 'payload' });
    queue.push({ path: 'c.ts', type: 'add', scope: 'lore' });

    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const cleared = queue.dismissAllScope('payload');
    assert.equal(cleared, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'clear');
    if (events[0]?.kind === 'clear') {
      assert.equal(events[0].scope, 'payload');
    }

    const snap = queue.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.path, 'c.ts');
    assert.equal(snap[0]?.scope, 'lore');
  } finally {
    handle.close();
  }
});

test('queue dismissAllScope on an empty scope is a no-op', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    queue.push({ path: 'c.ts', type: 'add', scope: 'lore' });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const cleared = queue.dismissAllScope('payload');
    assert.equal(cleared, 0);
    assert.equal(events.length, 0);
    assert.equal(queue.snapshot().length, 1);
  } finally {
    handle.close();
  }
});

test('queue dismiss of unknown id is a no-op', () => {
  const handle = openMemoryDb();
  try {
    const queue = createQueue({ db: handle.db });
    queue.push({ path: 'a.ts', type: 'add', scope: 'payload' });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    const removed = queue.dismiss('not-a-real-id');
    assert.equal(removed, false);
    assert.equal(events.length, 0);
    assert.equal(queue.snapshot().length, 1);
  } finally {
    handle.close();
  }
});
