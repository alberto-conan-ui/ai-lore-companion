import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isChainError, readChain } from '../src/index.js';
import { useTempDir } from './support/temp.js';

/**
 * Build a small project with a tracker chain in a temporary folder: a status
 * file pointing at a focus, and the focus pointing at a stage. The test never
 * reads this repository's own tracker folder.
 */
function writeChainFixture(root: string): void {
  const lore = join(root, '.ai-lore-example');
  const status = join(lore, 'memory', 'status');
  const focus = join(status, 'focus');
  mkdirSync(focus, { recursive: true });
  writeFileSync(join(lore, 'workspace.yaml'), 'project_name: example\n');
  writeFileSync(
    join(status, 'status.index.md'),
    [
      '---',
      'type: status',
      'title: example — Status',
      'updated: 2026-05-26',
      'references: []',
      'active_focus: ./focus/example.focus.md',
      'posture: execute',
      'dials:',
      '  altitude: mid',
      '  commitment: neutral',
      '---',
      '',
      '# example — Status',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(focus, 'example.focus.md'),
    [
      '---',
      'type: focus',
      'title: Example focus',
      'updated: 2026-05-26',
      'references: []',
      'status: Active',
      'focus_type: build',
      '---',
      '',
      '# Example focus',
      '',
      '## Active child pointer',
      '',
      '[Stage one](./stage-one.md)',
      '',
    ].join('\n'),
  );
  writeFileSync(join(focus, 'stage-one.md'), '# Stage one\n\nBody.\n');
}

test('chain reader resolves a tracker chain from the status file to the active child', (t) => {
  const root = useTempDir(t, 'ai-lore-chain-');
  writeChainFixture(root);

  const result = readChain({ root });
  assert.ok(
    !isChainError(result),
    `expected chain success, got error: ${'error' in result ? result.error : ''}`,
  );
  if (isChainError(result)) return;

  assert.equal(result.root, root);
  assert.equal(result.lorePath, join(root, '.ai-lore-example'));
  assert.equal(result.mode, 'execute');
  assert.ok(result.focus, 'focus should be present');
  assert.equal(result.focus.title, 'Example focus');
  assert.ok(result.focus.path.endsWith('example.focus.md'));
  assert.equal(result.focusType, 'build');
  assert.ok(result.activeChild, 'activeChild should be present');
  assert.equal(result.activeChild.title, 'Stage one');
  assert.ok(result.activeChild.path.endsWith('stage-one.md'));
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
