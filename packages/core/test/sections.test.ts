import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findSection, parseMemorySections } from '../src/index.js';

const FOCUS_BODY = `# Example focus

> **Status:** Active

## Gate

The build ships when:

- core 80/80
- e2e 14/14

### Sub-heading

prose continues.

## Context

Why this focus exists.

## In scope

- a thing
- another thing

## Out of scope

- not this
- not that

## Watch-outs

- a known sharp edge

## Stack

1. [Phase A](./A.phase.md)

## Active child pointer

[Phase A](./A.phase.md)

## Journal trail

_No entries yet._
`;

test('parseMemorySections extracts every H2 section', () => {
  const sections = parseMemorySections(FOCUS_BODY);
  assert.ok(sections.Gate);
  assert.ok(sections.Context);
  assert.ok(sections['In scope']);
  assert.ok(sections['Out of scope']);
  assert.ok(sections['Watch-outs']);
  assert.ok(sections.Stack);
  assert.ok(sections['Active child pointer']);
  assert.ok(sections['Journal trail']);
});

test('parseMemorySections keeps sub-headings inside their owning section', () => {
  const sections = parseMemorySections(FOCUS_BODY);
  assert.match(sections.Gate ?? '', /^### Sub-heading$/m);
  assert.match(sections.Gate ?? '', /prose continues\./);
  // The sub-heading does NOT escape into Context.
  assert.doesNotMatch(sections.Context ?? '', /Sub-heading/);
});

test('parseMemorySections trims surrounding whitespace per section', () => {
  const sections = parseMemorySections(FOCUS_BODY);
  // Gate's first character is "The" — the leading blank lines after `## Gate`
  // are trimmed.
  assert.ok((sections.Gate ?? '').startsWith('The build ships when:'));
  // And its last line is not a trailing blank.
  assert.ok(!(sections.Gate ?? '').endsWith('\n'));
});

test('parseMemorySections drops prose before the first H2', () => {
  const sections = parseMemorySections(FOCUS_BODY);
  // The H1 "# Example focus" and the Status quote sit before any H2 and
  // belong to no section. They appear in no key.
  for (const value of Object.values(sections)) {
    assert.doesNotMatch(value, /Example focus/);
    assert.doesNotMatch(value, /> \*\*Status:\*\* Active/);
  }
});

test('parseMemorySections returns an empty map for a body with no H2', () => {
  const sections = parseMemorySections('# Title only\n\nNo sections here.\n');
  assert.deepEqual(sections, {});
});

test('parseMemorySections returns an empty map for an empty body', () => {
  assert.deepEqual(parseMemorySections(''), {});
});

test('parseMemorySections handles a body whose final section runs to EOF', () => {
  const body = '## Gate\n\nlast line, no trailing blank.';
  const sections = parseMemorySections(body);
  assert.equal(sections.Gate, 'last line, no trailing blank.');
});

test('findSection is case-insensitive', () => {
  const sections = parseMemorySections('## Watch-outs\n\nbody\n');
  assert.equal(findSection(sections, 'watch-outs'), 'body');
  assert.equal(findSection(sections, 'WATCH-OUTS'), 'body');
  assert.equal(findSection(sections, 'Watch-outs'), 'body');
});

test('findSection returns undefined for a missing section', () => {
  const sections = parseMemorySections('## Gate\n\nbody\n');
  assert.equal(findSection(sections, 'Vision'), undefined);
});
