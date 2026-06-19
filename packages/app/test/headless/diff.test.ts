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

test('fileLog carries the author and full multi-line body (commit-details panel)', () => {
  // A body with its own `:`-prefixed line is the trap: it looks like a `--raw`
  // diff line. The \x02 sentinel closing the header is what keeps the body from
  // fooling the raw-line finder — assert the body survives intact and the raw
  // metadata (change status) is still read from the right place.
  writeFileSync(join(root, 'a.txt'), 'hello\nworld\nmore\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'second\n\nWhy: it matters\n:not-a-raw-line still body');
  const r = fileLog({ workingTreeRoot: root, gitRelPath: 'a.txt' });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  const top = r.entries[0];
  assert.equal(top?.subject, 'second');
  assert.equal(top?.author, 'Test');
  assert.equal(top?.body, 'Why: it matters\n:not-a-raw-line still body');
  assert.equal(top?.change, 'M', 'raw status still parsed past a `:`-line body');
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

test('fileLog flags a content-free move with its rename status, paths, and equal blobs', () => {
  // A pure `git mv` (no content edit) is the case that made the "All 3" view show
  // identical Parent/Commit panes. The rename commit must carry status `R…`, the
  // old/new paths, and `prevBlob === blob` (so the UI can describe the move).
  git('mv', 'a.txt', 'b.txt');
  git('commit', '-q', '-m', 'rename a→b');
  const r = fileLog({ workingTreeRoot: root, gitRelPath: 'b.txt' });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  const move = r.entries[0];
  assert.ok(move, 'rename commit present');
  assert.ok(move?.change.startsWith('R'), `status is a rename, got ${move?.change}`);
  assert.equal(move?.oldPath, 'a.txt');
  assert.equal(move?.newPath, 'b.txt');
  assert.equal(move?.prevBlob, move?.blob, 'a move with no content edit has equal blobs');
});

test('fileLog marks an added file: status A, all-zero prevBlob', () => {
  // The oldest version (the file's creation) has no earlier blob — `prevBlob` is
  // all-zeros, which the "All 3" Parent pane renders as "added in this commit".
  const r = fileLog({ workingTreeRoot: root, gitRelPath: 'a.txt' });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  const added = r.entries[r.entries.length - 1];
  assert.equal(added?.change, 'A');
  assert.ok(added && /^0+$/.test(added.prevBlob), 'added file has an all-zero prevBlob');
});
