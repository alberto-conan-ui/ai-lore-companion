import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_IGNORE_RULES,
  type IgnoreRule,
  createIgnoreMatcher,
  deriveIgnoreLists,
  isIgnoreRule,
  isUntrackedFile,
  mergeIgnoreRules,
  normalizeIgnorePattern,
} from '../src/index.js';

test('DEFAULT_IGNORE_RULES covers the build/scratch folders at no-search level', () => {
  assert.deepEqual(
    DEFAULT_IGNORE_RULES.map((r) => r.pattern),
    [
      '**/upstream/**',
      '**/.ai-lore-*/process/**',
      '**/.git/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-test/**',
      '**/out/**',
    ],
  );
  assert.ok(DEFAULT_IGNORE_RULES.every((r) => r.level === 'no-search'));
});

test('normalizeIgnorePattern expands bare names and file globs, keeps paths verbatim', () => {
  assert.equal(normalizeIgnorePattern('coverage'), '**/coverage/**');
  assert.equal(normalizeIgnorePattern('  tmp  '), '**/tmp/**');
  assert.equal(normalizeIgnorePattern('*.log'), '**/*.log');
  assert.equal(normalizeIgnorePattern('src/generated'), 'src/generated');
  assert.equal(normalizeIgnorePattern('**/dist/**'), '**/dist/**');
  assert.equal(normalizeIgnorePattern(''), '');
});

test('mergeIgnoreRules overrides by pattern and appends new rules', () => {
  const base: IgnoreRule[] = [
    { pattern: 'a', level: 'no-drift' },
    { pattern: 'b', level: 'no-search' },
  ];
  const override: IgnoreRule[] = [
    { pattern: 'b', level: 'hidden' },
    { pattern: 'c', level: 'no-drift' },
  ];
  assert.deepEqual(mergeIgnoreRules(base, override), [
    { pattern: 'a', level: 'no-drift' },
    { pattern: 'b', level: 'hidden' },
    { pattern: 'c', level: 'no-drift' },
  ]);
});

test('deriveIgnoreLists produces three cumulative, nesting lists', () => {
  const lists = deriveIgnoreLists([
    { pattern: 'd', level: 'no-drift' },
    { pattern: 's', level: 'no-search' },
    { pattern: 'h', level: 'hidden' },
  ]);
  // Every rule suppresses drift.
  assert.deepEqual(lists.drift, ['**/d/**', '**/s/**', '**/h/**']);
  // no-search and hidden suppress search.
  assert.deepEqual(lists.search, ['**/s/**', '**/h/**']);
  // hidden alone hides the tree.
  assert.deepEqual(lists.hidden, ['**/h/**']);
});

test('deriveIgnoreLists normalises patterns and drops empty ones', () => {
  const lists = deriveIgnoreLists([
    { pattern: '*.log', level: 'no-drift' },
    { pattern: '   ', level: 'hidden' },
  ]);
  assert.deepEqual(lists.drift, ['**/*.log']);
  assert.deepEqual(lists.hidden, []);
});

test('DEFAULT_IGNORE_RULES derive to drift + search suppression, but nothing hidden', () => {
  const lists = deriveIgnoreLists(DEFAULT_IGNORE_RULES);
  assert.equal(lists.drift.length, 7);
  assert.equal(lists.search.length, 7);
  assert.deepEqual(lists.hidden, []);
});

test('isIgnoreRule accepts well-formed rules and rejects malformed data', () => {
  assert.equal(isIgnoreRule({ pattern: 'dist', level: 'hidden' }), true);
  assert.equal(isIgnoreRule({ pattern: 'dist', level: 'bogus' }), false);
  assert.equal(isIgnoreRule({ pattern: 'dist' }), false);
  assert.equal(isIgnoreRule({ level: 'hidden' }), false);
  assert.equal(isIgnoreRule('dist'), false);
  assert.equal(isIgnoreRule(null), false);
});

test('createIgnoreMatcher matches a folder pattern by basename and as a path segment', () => {
  const isIgnored = createIgnoreMatcher(['**/node_modules/**', '**/.git/**']);
  assert.equal(isIgnored('node_modules'), true);
  assert.equal(isIgnored('packages/core/node_modules'), true);
  assert.equal(isIgnored('.git'), true);
  assert.equal(isIgnored('src'), false);
  assert.equal(isIgnored('node_modules.ts'), false);
});

test('createIgnoreMatcher matches a normalised file glob against a basename', () => {
  const isIgnored = createIgnoreMatcher([normalizeIgnorePattern('*.log')]);
  assert.equal(isIgnored('debug.log'), true);
  assert.equal(isIgnored('debug.txt'), false);
});

test('createIgnoreMatcher with an empty pattern list ignores nothing', () => {
  const isIgnored = createIgnoreMatcher([]);
  assert.equal(isIgnored('node_modules'), false);
});

test('isUntrackedFile silences AI-Lore index files only', () => {
  assert.equal(isUntrackedFile('memory.index.md'), true);
  assert.equal(isUntrackedFile('cockpit-pane-refinements.index.md'), true);
  assert.equal(isUntrackedFile('status.md'), false);
  assert.equal(isUntrackedFile('README.md'), false);
  assert.equal(isUntrackedFile('index.md'), false);
});
