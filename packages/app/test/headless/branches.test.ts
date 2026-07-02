import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { readBranches } from '../../src/main/branches.js';

const GIT_USER = ['-c', 'user.email=t@t', '-c', 'user.name=T'];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeRepo(branch: string): { dir: string; git: (...a: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-branches-'));
  dirs.push(dir);
  const git = (...a: string[]): string =>
    execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  execFileSync('git', ['-C', dir, ...GIT_USER, 'commit', '--allow-empty', '-m', 'seed'], {
    cwd: dir,
  });
  return { dir, git };
}

test('readBranches pairs the two repos by scope', () => {
  const payload = makeRepo('main');
  const lore = makeRepo('lore-work');
  const r = readBranches(payload.dir, lore.dir);
  assert.deepEqual(r.payload, { kind: 'ok', branch: 'main', detached: false });
  assert.deepEqual(r.lore, { kind: 'ok', branch: 'lore-work', detached: false });
});

test('readBranches surfaces a detached HEAD as detached, not a name', () => {
  const payload = makeRepo('main');
  const lore = makeRepo('main');
  lore.git('checkout', '-q', '--detach');
  const r = readBranches(payload.dir, lore.dir);
  assert.deepEqual(r.payload, { kind: 'ok', branch: 'main', detached: false });
  assert.deepEqual(r.lore, { kind: 'ok', branch: '', detached: true });
});

test('readBranches reports a non-repo side as failed without touching the other', () => {
  const payload = makeRepo('main');
  const notARepo = mkdtempSync(join(tmpdir(), 'cockpit-branches-'));
  dirs.push(notARepo);
  const r = readBranches(payload.dir, notARepo);
  assert.equal(r.payload.kind, 'ok');
  assert.equal(r.lore.kind, 'failed');
});
