import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { currentBranch, isAncestor } from '../src/index.js';

const GIT_USER = ['-c', 'user.email=t@t', '-c', 'user.name=T'];

function makeRepo(): {
  dir: string;
  cleanup: () => void;
  commit: (msg: string) => string;
  git: (...a: string[]) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'gitinfo-test-'));
  const git = (...a: string[]): string =>
    execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  const commit = (msg: string): string => {
    execFileSync('git', ['-C', dir, ...GIT_USER, 'commit', '--allow-empty', '-m', msg], {
      cwd: dir,
    });
    return git('rev-parse', 'HEAD');
  };
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), commit, git };
}

test('currentBranch reads the checked-out branch name', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    commit('seed');
    const r = currentBranch(dir);
    assert.equal(r.kind, 'ok');
    if (r.kind !== 'ok') return;
    assert.equal(r.branch, 'main');
    assert.equal(r.detached, false);
  } finally {
    cleanup();
  }
});

test('currentBranch follows a branch switch', () => {
  const { dir, cleanup, commit, git } = makeRepo();
  try {
    commit('seed');
    git('checkout', '-q', '-b', 'feature/x');
    const r = currentBranch(dir);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.branch, 'feature/x');
  } finally {
    cleanup();
  }
});

test('currentBranch flags a detached HEAD with empty branch', () => {
  const { dir, cleanup, commit, git } = makeRepo();
  try {
    const sha = commit('seed');
    git('checkout', '-q', sha);
    const r = currentBranch(dir);
    assert.equal(r.kind, 'ok');
    if (r.kind !== 'ok') return;
    assert.equal(r.detached, true);
    assert.equal(r.branch, '');
  } finally {
    cleanup();
  }
});

test('currentBranch fails on a non-repo path', () => {
  const r = currentBranch('/tmp/this-does-not-exist-98765');
  assert.equal(r.kind, 'failed');
});

test('isAncestor is true for a commit on the current branch', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    const first = commit('first');
    commit('second');
    const r = isAncestor(first, dir);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.isAncestor, true);
  } finally {
    cleanup();
  }
});

test('isAncestor is false for a commit off the current branch', () => {
  const { dir, cleanup, commit, git } = makeRepo();
  try {
    commit('seed');
    // Branch off, commit, then return to main — the off-branch commit is not an
    // ancestor of main's HEAD. This is exactly the cross-branch baseline case.
    git('checkout', '-q', '-b', 'side');
    const sideSha = commit('side-only');
    git('checkout', '-q', 'main');
    const r = isAncestor(sideSha, dir);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.isAncestor, false);
  } finally {
    cleanup();
  }
});

test('isAncestor fails (not false) on an unknown SHA', () => {
  const { dir, cleanup, commit } = makeRepo();
  try {
    commit('seed');
    const r = isAncestor('0'.repeat(40), dir);
    assert.equal(r.kind, 'failed');
  } finally {
    cleanup();
  }
});
