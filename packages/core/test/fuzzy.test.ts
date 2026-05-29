import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fuzzyScore } from '../src/index.js';

test('fuzzyScore returns null when the query is not a subsequence', () => {
  assert.equal(fuzzyScore('xyz', 'abc'), null);
  assert.equal(fuzzyScore('abz', 'abc'), null);
  // Out of order — subsequence must preserve order.
  assert.equal(fuzzyScore('ba', 'abc'), null);
  // Longer than the target.
  assert.equal(fuzzyScore('abcd', 'abc'), null);
});

test('fuzzyScore matches a subsequence and is case-insensitive', () => {
  assert.notEqual(fuzzyScore('abc', 'abc'), null);
  assert.notEqual(fuzzyScore('ABC', 'abc'), null);
  assert.notEqual(fuzzyScore('ac', 'abc'), null);
});

test('fuzzyScore: empty query scores 0 (matches everything)', () => {
  assert.equal(fuzzyScore('', 'anything.ts'), 0);
});

function rank(query: string, targets: string[]): string[] {
  return targets
    .map((t) => ({ t, s: fuzzyScore(query, t) }))
    .filter((x): x is { t: string; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

test('ranks a contiguous prefix match above a scattered match', () => {
  const ranked = rank('btn', ['button.ts', 'btn.ts', 'subtitleN.ts']);
  assert.equal(ranked[0], 'btn.ts');
});

test('ranks a shorter target above a longer one on an equal-structure tie', () => {
  const ranked = rank('index', ['index.test.ts', 'index.ts']);
  assert.equal(ranked[0], 'index.ts');
});

test('rewards a match at a path/word boundary over a mid-word match', () => {
  // "ai" at the start of a boundary segment beats "ai" buried in "main".
  const boundary = fuzzyScore('ai', 'ai-tab.ts');
  const midword = fuzzyScore('ai', 'main.ts');
  assert.ok(boundary !== null && midword !== null);
  assert.ok((boundary as number) > (midword as number));
});

test('rewards a camelCase hump match', () => {
  // "tk" matches the T and K humps in "TabKind" contiguously-ish via boundaries.
  const camel = fuzzyScore('tk', 'TabKind.tsx');
  assert.notEqual(camel, null);
  // A non-hump scatter of the same chars scores lower.
  const scatter = fuzzyScore('tk', 'trunkfile.tsx');
  assert.ok(camel !== null && scatter !== null);
  assert.ok((camel as number) > (scatter as number));
});
