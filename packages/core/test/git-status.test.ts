import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachGitStatusTracker, readGitStatus } from '../src/index.js';

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'git-status-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'seed'], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readGitStatus returns failed for a non-repo path', () => {
  const result = readGitStatus('/tmp/this-does-not-exist-12345');
  assert.equal(result.kind, 'failed');
});

test('readGitStatus returns an empty list for a clean repo', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const result = readGitStatus(dir);
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.deepEqual(result.entries, []);
  } finally {
    cleanup();
  }
});

test('readGitStatus reports an untracked file', () => {
  const { dir, cleanup } = makeRepo();
  try {
    writeFileSync(join(dir, 'new.txt'), 'hello');
    const result = readGitStatus(dir);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.path, 'new.txt');
    assert.equal(result.entries[0]?.code, '??');
  } finally {
    cleanup();
  }
});

test('readGitStatus reports a modified tracked file', () => {
  const { dir, cleanup } = makeRepo();
  try {
    writeFileSync(join(dir, 'tracked.txt'), 'one');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'add tracked'], { cwd: dir });
    writeFileSync(join(dir, 'tracked.txt'), 'two');
    const result = readGitStatus(dir);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.path, 'tracked.txt');
    // ` M` — modified in working tree, clean in index.
    assert.equal(result.entries[0]?.code, ' M');
  } finally {
    cleanup();
  }
});

test('readGitStatus handles paths inside subdirectories', () => {
  const { dir, cleanup } = makeRepo();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'nested.txt'), 'data');
    const result = readGitStatus(dir);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries[0]?.path, 'sub/nested.txt');
  } finally {
    cleanup();
  }
});

test('attachGitStatusTracker seeds both snapshots on attach', () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    writeFileSync(join(payload.dir, 'a.txt'), 'a');
    writeFileSync(join(lore.dir, 'b.txt'), 'b');
    const events: { scope: string; count: number }[] = [];
    const tracker = attachGitStatusTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 10,
      onChange: (scope, entries) => events.push({ scope, count: entries.length }),
    });
    try {
      const snap = tracker.snapshot();
      assert.equal(snap.payload.length, 1);
      assert.equal(snap.lore.length, 1);
      // Seed reads fire onChange for both scopes (initial snapshot moves
      // from empty to populated).
      assert.deepEqual(
        events.map((e) => e.scope).sort(),
        ['lore', 'payload'],
      );
    } finally {
      tracker.close();
    }
  } finally {
    payload.cleanup();
    lore.cleanup();
  }
});

test('scheduleRefresh debounces multiple calls into one re-read', async () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    let calls = 0;
    const tracker = attachGitStatusTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 30,
      onChange: () => {
        calls += 1;
      },
    });
    try {
      const seedCalls = calls;
      writeFileSync(join(payload.dir, 'a.txt'), 'a');
      tracker.scheduleRefresh('payload');
      tracker.scheduleRefresh('payload');
      tracker.scheduleRefresh('payload');
      await new Promise((r) => setTimeout(r, 60));
      // Exactly one additional call (the snapshot moved from empty to 1 entry).
      assert.equal(calls - seedCalls, 1);
    } finally {
      tracker.close();
    }
  } finally {
    payload.cleanup();
    lore.cleanup();
  }
});

test('tracker does not re-emit onChange when the snapshot is unchanged', async () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    let calls = 0;
    const tracker = attachGitStatusTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 5,
      onChange: () => {
        calls += 1;
      },
    });
    try {
      // Seed fired onChange once already.
      const seedCalls = calls;
      tracker.scheduleRefresh('payload');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(calls - seedCalls, 0);
    } finally {
      tracker.close();
    }
  } finally {
    payload.cleanup();
    lore.cleanup();
  }
});
