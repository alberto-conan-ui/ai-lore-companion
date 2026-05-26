import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type ChangeScope,
  attachChangesTracker,
  readChanges,
  readCommitList,
  readDiffText,
} from '../src/index.js';

const GIT_USER = ['-c', 'user.email=t@t', '-c', 'user.name=T'];

function makeRepo(): { dir: string; cleanup: () => void; commit: (msg: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'changes-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...GIT_USER, 'commit', '--allow-empty', '-m', 'seed'], { cwd: dir });
  const commit = (msg: string): string => {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', [...GIT_USER, 'commit', '--allow-empty', '-m', msg], { cwd: dir });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  };
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), commit };
}

test('readChanges(HEAD) returns failed for a non-repo path', () => {
  const result = readChanges('/tmp/this-does-not-exist-12345', 'HEAD');
  assert.equal(result.kind, 'failed');
});

test('readChanges(HEAD) returns an empty list for a clean repo', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const result = readChanges(dir, 'HEAD');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.deepEqual(result.entries, []);
  } finally {
    cleanup();
  }
});

test('readChanges(HEAD) reports an untracked file', () => {
  const { dir, cleanup } = makeRepo();
  try {
    writeFileSync(join(dir, 'new.txt'), 'hello');
    const result = readChanges(dir, 'HEAD');
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.path, 'new.txt');
    assert.equal(result.entries[0]?.code, '??');
  } finally {
    cleanup();
  }
});

test('readChanges(HEAD) reports a modified tracked file', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    writeFileSync(join(dir, 'tracked.txt'), 'one');
    commit('add tracked');
    writeFileSync(join(dir, 'tracked.txt'), 'two');
    const result = readChanges(dir, 'HEAD');
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.path, 'tracked.txt');
    assert.equal(result.entries[0]?.code, ' M');
  } finally {
    cleanup();
  }
});

test('readChanges(HEAD) handles paths inside subdirectories', () => {
  const { dir, cleanup } = makeRepo();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'nested.txt'), 'data');
    const result = readChanges(dir, 'HEAD');
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries[0]?.path, 'sub/nested.txt');
  } finally {
    cleanup();
  }
});

test('readChanges(commit-sha) shows modified file as M', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'one');
    const sha = commit('add a');
    writeFileSync(join(dir, 'a.txt'), 'two');
    commit('modify a');
    const result = readChanges(dir, sha);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.path, 'a.txt');
    assert.equal(result.entries[0]?.code, 'M ');
  } finally {
    cleanup();
  }
});

test('readChanges(commit-sha) shows added file as A', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    const sha = commit('seed-commit'); // empty add commit
    writeFileSync(join(dir, 'b.txt'), 'b');
    commit('add b');
    const result = readChanges(dir, sha);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    const added = result.entries.find((e) => e.path === 'b.txt');
    assert.ok(added);
    assert.equal(added?.code, 'A ');
  } finally {
    cleanup();
  }
});

test('readChanges(commit-sha) shows deleted file as D', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    writeFileSync(join(dir, 'c.txt'), 'c');
    const sha = commit('add c');
    rmSync(join(dir, 'c.txt'));
    commit('remove c');
    const result = readChanges(dir, sha);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    const deleted = result.entries.find((e) => e.path === 'c.txt');
    assert.ok(deleted);
    assert.equal(deleted?.code, 'D ');
  } finally {
    cleanup();
  }
});

test('readChanges(commit-sha) includes untracked working-tree files', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    const sha = commit('seed-commit');
    writeFileSync(join(dir, 'untracked.txt'), 'untracked');
    const result = readChanges(dir, sha);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    const untracked = result.entries.find((e) => e.path === 'untracked.txt');
    assert.ok(untracked);
    assert.equal(untracked?.code, '??');
  } finally {
    cleanup();
  }
});

test('readDiffText returns the unified diff for a modified file', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    commit('add a');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const result = readDiffText(dir, 'HEAD', 'a.txt');
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.ok(result.text.includes('-one'));
    assert.ok(result.text.includes('+two'));
  } finally {
    cleanup();
  }
});

test('readCommitList returns recent commits newest first', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'a');
    const sha1 = commit('first');
    writeFileSync(join(dir, 'b.txt'), 'b');
    const sha2 = commit('second');
    const result = readCommitList(dir, 10);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    // Newest first: sha2 (second), sha1 (first), then 'seed'.
    assert.equal(result.commits[0]?.sha, sha2);
    assert.equal(result.commits[0]?.subject, 'second');
    assert.equal(result.commits[1]?.sha, sha1);
    assert.equal(result.commits[1]?.subject, 'first');
  } finally {
    cleanup();
  }
});

test('attachChangesTracker seeds both snapshots on attach (HEAD baseline)', () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    writeFileSync(join(payload.dir, 'a.txt'), 'a');
    writeFileSync(join(lore.dir, 'b.txt'), 'b');
    const events: { scope: string; count: number }[] = [];
    const tracker = attachChangesTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 10,
      onChange: (scope, entries) => events.push({ scope, count: entries.length }),
    });
    try {
      const snap = tracker.snapshot();
      assert.equal(snap.payload.length, 1);
      assert.equal(snap.lore.length, 1);
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
    const tracker = attachChangesTracker({
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
    const tracker = attachChangesTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 5,
      onChange: () => {
        calls += 1;
      },
    });
    try {
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

test('setBaseline fires onChange even when both snapshots are empty (no dedup)', () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    // Clean working tree against HEAD → empty snapshot. Switching to a SHA
    // that also produces an empty snapshot must still fire onChange so the
    // renderer knows it's now looking at a different baseline.
    const sha = payload.commit('first');
    const events: ChangeScope[] = [];
    const tracker = attachChangesTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 5,
      onChange: (scope) => events.push(scope),
    });
    try {
      const seedEvents = events.length;
      tracker.setBaseline('payload', sha);
      assert.equal(
        events.length - seedEvents,
        1,
        'setBaseline must fire onChange even when entries match the old snapshot',
      );
    } finally {
      tracker.close();
    }
  } finally {
    payload.cleanup();
    lore.cleanup();
  }
});

test('setBaseline triggers an immediate re-read against the new baseline', () => {
  const payload = makeRepo();
  const lore = makeRepo();
  try {
    // Create a commit, then modify the file. HEAD baseline = working-tree
    // vs. latest commit ≠ baseline = working-tree vs. older commit.
    writeFileSync(join(payload.dir, 'a.txt'), 'one\n');
    payload.commit('first');
    const events: { scope: string; codes: string[] }[] = [];
    const tracker = attachChangesTracker({
      payloadRoot: payload.dir,
      loreRoot: lore.dir,
      debounceMs: 5,
      onChange: (scope, entries) =>
        events.push({ scope, codes: entries.map((e) => e.code) }),
    });
    try {
      // Seed: HEAD baseline against committed file → no changes.
      assert.equal(tracker.snapshot().payload.length, 0);
      const initialEvents = events.length;
      // Flip baseline to a non-existent SHA → diff fails silently to empty.
      // Use the empty-tree SHA: 4b825dc642cb6eb9a060e54bf8d69288fbee4904.
      tracker.setBaseline('payload', '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
      // Should have fired an onChange for payload (now non-empty: a.txt as added).
      assert.ok(events.length > initialEvents, 'setBaseline triggers onChange');
      const last = events[events.length - 1];
      assert.equal(last?.scope, 'payload');
      assert.ok(last?.codes.includes('A '));
    } finally {
      tracker.close();
    }
  } finally {
    payload.cleanup();
    lore.cleanup();
  }
});
