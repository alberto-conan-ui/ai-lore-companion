import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { readBaselineText } from '../../src/main/diff.js';

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
