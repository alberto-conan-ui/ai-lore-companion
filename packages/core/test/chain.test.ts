import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { isChainError, readChain } from '../src/index.js';

function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (
      existsSync(resolve(dir, 'package.json')) &&
      readdirSync(dir).some((n) => n.startsWith('.ai-lore-'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate project root from ${start}`);
}

const PROJECT_ROOT = findProjectRoot(process.cwd());

test("chain reader resolves this project's own tracker chain", () => {
  const result = readChain({ root: PROJECT_ROOT });
  assert.ok(
    !isChainError(result),
    `expected chain success, got error: ${'error' in result ? result.error : ''}`,
  );
  if (isChainError(result)) return;

  assert.equal(result.root, PROJECT_ROOT);
  assert.ok(result.lorePath.endsWith('.ai-lore-ai-lore-companion'));
  assert.ok(result.mode.length > 0);
  assert.ok(result.focus, 'focus should be present');
  assert.ok(result.focus.title.length > 0);
  assert.ok(result.focus.path.endsWith('.focus.md'));
  assert.ok(result.activeChild, 'activeChild should be present');
  assert.ok(result.activeChild.title.length > 0);
  assert.ok(result.activeChild.path.endsWith('.md'));
});

test('chain reader returns error for non-existent root', () => {
  const result = readChain({ root: '/this/path/does/not/exist/anywhere' });
  assert.ok(isChainError(result));
  if (isChainError(result)) {
    assert.match(result.error, /cannot read project root|no \.ai-lore-/);
  }
});

test('chain reader returns error when root has no .ai-lore-* folder', () => {
  const result = readChain({ root: '/tmp' });
  assert.ok(isChainError(result));
  if (isChainError(result)) {
    assert.match(result.error, /no \.ai-lore-/);
  }
});
