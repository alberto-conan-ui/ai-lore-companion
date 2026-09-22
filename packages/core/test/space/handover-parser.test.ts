import assert from 'node:assert/strict';
import test from 'node:test';
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

const JOURNAL_VARIANTS = [
  {
    name: 'Markdown labels',
    entry: `
## Handover

### Done
Completed the parser.

### In progress
Nothing.

### What the next session should do
Review it.
`.trim(),
    expected: {
      done: 'Completed the parser.',
      inProgress: 'Nothing.',
      nextAction: 'Review it.',
      fallback: false,
    },
  },
  {
    name: 'alternate Markdown labels',
    entry: `
## Handover

### What was done
Completed the parser.

### What is in progress
Nothing.

### Next action
Review it.
`.trim(),
    expected: {
      done: 'Completed the parser.',
      inProgress: 'Nothing.',
      nextAction: 'Review it.',
      fallback: false,
    },
  },
  {
    name: 'bold labels',
    entry: `
## Handover

**What was done**
Completed the parser.

**What is in progress**
Nothing.

**What the next session should do**
Review it.
`.trim(),
    expected: {
      done: 'Completed the parser.',
      inProgress: 'Nothing.',
      nextAction: 'Review it.',
      fallback: false,
    },
  },
  {
    name: 'bold prose under a recognized label',
    entry: `
## Handover

**What was done**
**Everything is done already**
`.trim(),
    expected: {
      done: '**Everything is done already**',
      inProgress: null,
      nextAction: null,
      fallback: false,
    },
  },
  {
    name: 'a handover without labels',
    entry: `
## Handover

The handover is prose.
It still reaches the fallback.
`.trim(),
    expected: {
      done: null,
      inProgress: null,
      nextAction: null,
      fallback: true,
    },
  },
] as const;

test('parses five portable journal variants', () => {
  for (const fixture of JOURNAL_VARIANTS) {
    const result = parseHandover(fixture.entry);
    assert.deepEqual(
      {
        done: result.done,
        inProgress: result.inProgress,
        nextAction: result.nextAction,
        fallback: result.fallback,
      },
      fixture.expected,
      fixture.name,
    );
  }
});
