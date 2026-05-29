import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRipgrepJson } from '../../src/main/search/content.js';

/** A realistic ripgrep `--json` line for one match. */
function matchLine(path: string, lineNumber: number, text: string, start: number): string {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: path },
      lines: { text: `${text}\n` },
      line_number: lineNumber,
      submatches: [{ match: { text: 'q' }, start, end: start + 1 }],
    },
  });
}

test('parseRipgrepJson extracts file, 1-based line/column, and a trimmed snippet', () => {
  const out = matchLine('/proj/src/fuzzy.ts', 42, '  const s = fuzzyScore(query)', 14);
  const hits = parseRipgrepJson(out, 50);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    name: 'fuzzy.ts',
    path: '/proj/src/fuzzy.ts',
    line: 42,
    column: 15, // start 14 → 1-based 15
    snippet: 'const s = fuzzyScore(query)', // leading whitespace + trailing \n trimmed
  });
});

test('parseRipgrepJson skips non-match records (begin/end/summary) and blank lines', () => {
  const out = [
    JSON.stringify({ type: 'begin', data: { path: { text: '/proj/a.ts' } } }),
    '',
    matchLine('/proj/a.ts', 1, 'hit one', 0),
    JSON.stringify({ type: 'end', data: {} }),
    JSON.stringify({ type: 'summary', data: {} }),
  ].join('\n');
  const hits = parseRipgrepJson(out, 50);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.name, 'a.ts');
});

test('parseRipgrepJson respects the limit', () => {
  const out = Array.from({ length: 10 }, (_, i) =>
    matchLine(`/p/f${i}.ts`, i + 1, `line ${i}`, 0),
  ).join('\n');
  assert.equal(parseRipgrepJson(out, 3).length, 3);
});

test('parseRipgrepJson tolerates malformed JSON lines', () => {
  const out = ['not json at all', matchLine('/p/ok.ts', 5, 'ok', 0), '{ broken'].join('\n');
  const hits = parseRipgrepJson(out, 50);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.line, 5);
});

test('parseRipgrepJson defaults column to 1 when no submatch is present', () => {
  const out = JSON.stringify({
    type: 'match',
    data: { path: { text: '/p/x.ts' }, lines: { text: 'x\n' }, line_number: 2 },
  });
  assert.equal(parseRipgrepJson(out, 50)[0]?.column, 1);
});
