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

test('parses real entries with bold labels', () => {
  const entry = `
## Handover

**What was done**
- Implemented the fix for the \`Ctrl+S\` terminal freeze bug in the companion app source code.
- Guided the Human Lead through compiling and locating the new macOS binary.

**What is in progress**
- The edits to fix the terminal freeze are sitting **uncommitted** in the working tree. 

**What the next session should do**
1. Orient.
2. Commit the uncommitted flow control fixes.
`.trim();

  const result = parseHandover(entry);
  assert.equal(result.fallback, false);
  assert.ok(result.done?.includes('Implemented the fix'));
  assert.ok(result.inProgress?.includes('terminal freeze'));
  assert.ok(result.nextAction?.includes('Orient.'));
});
