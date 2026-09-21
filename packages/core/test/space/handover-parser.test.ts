import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHandover } from '../../src/space/project/session-issue.js';

test('parses handover with all three parts', () => {
  const entry = `
## Handover

### Done
Finished A.
Finished B.

### In progress
Working on C.

### What the next session should do
Fix D.
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, false);
  assert.equal(result.done, 'Finished A.\nFinished B.');
  assert.equal(result.inProgress, 'Working on C.');
  assert.equal(result.nextAction, 'Fix D.');
});

test('parses handover with missing parts', () => {
  const entry = `
## Handover

### What was done
Something.
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, false);
  assert.equal(result.done, 'Something.');
  assert.equal(result.inProgress, null);
  assert.equal(result.nextAction, null);
});

test('parses handover with missing headings but a handover block', () => {
  const entry = `
## Handover

I forgot the headings.
But here is some text.
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, true);
  assert.equal(result.done, null);
  assert.equal(result.inProgress, null);
  assert.equal(result.nextAction, null);
  assert.equal(result.text, 'I forgot the headings.\nBut here is some text.');
});

test('parses fallback with opening lines when no handover heading', () => {
  const entry = `
### Some note

Line 1
Line 2
Line 3
Line 4
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, true);
  assert.equal(result.done, null);
  assert.equal(result.inProgress, null);
  assert.equal(result.nextAction, null);
  assert.equal(result.text, 'Line 1\nLine 2\nLine 3');
});

test('empty input', () => {
  const result = parseHandover('');
  assert.equal(result.fallback, true);
  assert.equal(result.text, '');
});

test('handles malformed headings', () => {
  const entry = `
## Handover

### What is in progress
Working.

### Next action
Action!
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, false);
  assert.equal(result.done, null);
  assert.equal(result.inProgress, 'Working.');
  assert.equal(result.nextAction, 'Action!');
});

import fs from 'node:fs';
import path from 'node:path';

test('parses real entries from journal', () => {
  const journalDir = '/Users/albertogutierrez/Spaces/ai-lore/workbench/journal/';
  const files = fs.readdirSync(journalDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(journalDir, file), 'utf-8');
    const result = parseHandover(content);
    assert.ok(result);
    if (file === '2026-09-21-1324-pty-flow-control-s-20260921-1101-b7bd5f.md') {
      assert.equal(result.fallback, false);
      assert.ok(result.done?.includes('Implemented the fix'));
      assert.ok(result.inProgress?.includes('terminal freeze'));
      assert.ok(result.nextAction?.includes('Orient.'));
    }
  }
});
