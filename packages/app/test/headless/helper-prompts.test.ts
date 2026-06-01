import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promptFor } from '../../src/main/helper/hooks.js';

const STATUS = '/proj/.ai-lore-proj/memory/status/status.index.md';

test('summarize-pending points the helper at the status file', () => {
  const p = promptFor('summarize-pending', { statusPath: STATUS });
  assert.match(p, /status\.index\.md/);
  assert.match(p, /pending or in progress/i);
});

test('what-changed with a clean tree asks for a one-line "nothing changed"', () => {
  const p = promptFor('what-changed', { statusPath: STATUS, changedPaths: [] });
  assert.match(p, /no uncommitted changes|clean/i);
  // No bullet list when there's nothing to list.
  assert.doesNotMatch(p, /^- /m);
});

test('what-changed lists the supplied changed paths as a bullet list', () => {
  const p = promptFor('what-changed', {
    statusPath: STATUS,
    changedPaths: ['src/a.ts', '[lore] status/status.index.md'],
  });
  assert.match(p, /- src\/a\.ts/);
  assert.match(p, /- \[lore\] status\/status\.index\.md/);
  assert.match(p, /what changed/i);
});
