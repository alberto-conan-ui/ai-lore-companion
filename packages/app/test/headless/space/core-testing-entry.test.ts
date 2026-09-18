import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import * as core from '@ai-lore-companion/core';
import * as coreTesting from '@ai-lore-companion/core/testing';

// The fixture builders of core are reached through the package entry
// `@ai-lore-companion/core/testing`, never through the main barrel, which the
// main process loads in production. This file shows that the app's headless
// tests can resolve that entry, and that loading it changes nothing.

test('the app resolves the fixture builders from @ai-lore-companion/core/testing', async () => {
  assert.equal(typeof coreTesting.makePlainRepository, 'function');
  assert.equal(typeof coreTesting.createScriptedRunner, 'function');

  const repo = await coreTesting.makePlainRepository();
  try {
    assert.equal(existsSync(repo.dir), true);
    assert.match(repo.head, /^[0-9a-f]{40}$/);
  } finally {
    repo.cleanup();
  }
  assert.equal(existsSync(repo.dir), false);
});

test('the main barrel of core carries no fixture builder', () => {
  const barrelNames = new Set(Object.keys(core));
  assert.deepEqual(
    Object.keys(coreTesting).filter((name) => barrelNames.has(name)),
    [],
  );
});

test('test mode is switched on by calling a builder, not by loading the entry', async () => {
  // A child process, so that the builders called above do not count.
  const { execFileSync } = await import('node:child_process');
  const script = [
    "const before = process.env.AI_LORE_TEST ?? '';",
    "const entry = await import('@ai-lore-companion/core/testing');",
    "const afterLoad = process.env.AI_LORE_TEST ?? '';",
    'entry.makeTempDir().cleanup();',
    "console.log(JSON.stringify([before, afterLoad, process.env.AI_LORE_TEST ?? '']));",
  ].join('\n');
  const env = { ...process.env };
  env.AI_LORE_TEST = undefined;
  env.NODE_ENV = undefined;
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out.trim()), ['', '', '1']);
});
