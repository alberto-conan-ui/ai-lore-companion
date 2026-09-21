import { expect, test } from 'vitest';
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
  expect(result.fallback).toBe(false);
  expect(result.done).toBe('Finished A.\nFinished B.');
  expect(result.inProgress).toBe('Working on C.');
  expect(result.nextAction).toBe('Fix D.');
});

test('parses handover with missing parts', () => {
  const entry = `
## Handover

### What was done
Something.
`.trim();

  const result = parseHandover(entry);
  expect(result.fallback).toBe(false);
  expect(result.done).toBe('Something.');
  expect(result.inProgress).toBeNull();
  expect(result.nextAction).toBeNull();
});

test('parses handover with missing headings but a handover block', () => {
  const entry = `
## Handover

I forgot the headings.
But here is some text.
`.trim();

  const result = parseHandover(entry);
  expect(result.fallback).toBe(true);
  expect(result.done).toBeNull();
  expect(result.inProgress).toBeNull();
  expect(result.nextAction).toBeNull();
  expect(result.text).toBe('I forgot the headings.\nBut here is some text.');
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
  expect(result.fallback).toBe(true);
  expect(result.done).toBeNull();
  expect(result.inProgress).toBeNull();
  expect(result.nextAction).toBeNull();
  expect(result.text).toBe('Line 1\nLine 2\nLine 3');
});

test('empty input', () => {
  const result = parseHandover('');
  expect(result.fallback).toBe(true);
  expect(result.text).toBe('');
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
  expect(result.fallback).toBe(false);
  expect(result.done).toBeNull();
  expect(result.inProgress).toBe('Working.');
  expect(result.nextAction).toBe('Action!');
});
