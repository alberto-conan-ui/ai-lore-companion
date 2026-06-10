import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileLog, readBaselineText, readBlobText } from '../../src/main/diff.js';

// `readBaselineText` powers the in-app side-by-side diff (Read-only IDE P3) — it
// reads a file's content at a commit via `git show`. Exercise it against a real
// throwaway repo.

let root: string;
function git(...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}
function head(): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cockpit-diff-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'a.txt'), 'hello\nworld\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('readBaselineText returns the committed content', () => {
  assert.deepEqual(
    readBaselineText({ workingTreeRoot: root, commit: head(), gitRelPath: 'a.txt' }),
    {
      kind: 'ok',
      text: 'hello\nworld\n',
    },
  );
});

test('readBaselineText yields empty text for a path absent at the commit', () => {
  // A file added after the baseline diffs as wholly-new against empty.
  assert.deepEqual(
    readBaselineText({ workingTreeRoot: root, commit: head(), gitRelPath: 'new.txt' }),
    { kind: 'ok', text: '' },
  );
});

test('fileLog lists the commits that touched a file, newest first', () => {
  writeFileSync(join(root, 'a.txt'), 'hello\nworld\nmore\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'second');
  const r = fileLog({ workingTreeRoot: root, gitRelPath: 'a.txt' });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(
    r.entries.map((e) => e.subject),
    ['second', 'first'],
  );
  assert.ok((r.entries[0]?.timestamp ?? 0) > 0, 'timestamp populated (epoch ms)');
});

test('fileLog returns an empty list for an untracked path', () => {
  assert.deepEqual(fileLog({ workingTreeRoot: root, gitRelPath: 'never.txt' }), {
    kind: 'ok',
    entries: [],
  });
});

test('fileLog carries each version blob; readBlobText reads it across a rename', () => {
  // `a.txt` = "hello\nworld\n" at the first commit (beforeEach). Move it, commit.
  git('mv', 'a.txt', 'b.txt');
  git('commit', '-q', '-m', 'rename a→b');
  const r = fileLog({ workingTreeRoot: root, gitRelPath: 'b.txt' });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  // `--follow` lists both the rename commit and the original (under a.txt).
  assert.equal(r.entries.length, 2);
  const older = r.entries[1];
  assert.ok(older && /^[0-9a-f]{40}$/.test(older.blob), 'blob is a full SHA');
  // The pre-rename version is readable **by blob** — even though `b.txt` did not
  // exist at that commit. This is the move-safe path `git show <c>:b.txt` misses.
  assert.deepEqual(readBlobText(root, older.blob), { kind: 'ok', text: 'hello\nworld\n' });
});
