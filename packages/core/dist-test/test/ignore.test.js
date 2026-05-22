import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_IGNORED, createIgnoreMatcher, isUntrackedFile, parseIgnorePatterns, readProjectIgnores, } from '../src/index.js';
test('DEFAULT_IGNORED covers the cockpit exclusion set', () => {
    assert.deepEqual([...DEFAULT_IGNORED], [
        '**/upstream/**',
        '**/process/**',
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-test/**',
        '**/out/**',
    ]);
});
test('createIgnoreMatcher matches each DEFAULT_IGNORED folder by basename', () => {
    const isIgnored = createIgnoreMatcher(DEFAULT_IGNORED);
    for (const name of ['upstream', 'process', '.git', 'node_modules', 'dist', 'dist-test', 'out']) {
        assert.equal(isIgnored(name), true, `expected '${name}' to be ignored`);
    }
});
test('createIgnoreMatcher matches an ignored folder as a path segment', () => {
    const isIgnored = createIgnoreMatcher(DEFAULT_IGNORED);
    assert.equal(isIgnored('packages/core/node_modules'), true);
    assert.equal(isIgnored('node_modules/better-sqlite3/lib'), true);
    assert.equal(isIgnored('.ai-lore-x/upstream/core-0.4'), true);
});
test('createIgnoreMatcher does not match names that merely contain an ignored token', () => {
    const isIgnored = createIgnoreMatcher(DEFAULT_IGNORED);
    assert.equal(isIgnored('node_modules.ts'), false);
    assert.equal(isIgnored('src/dist-helpers.ts'), false);
    assert.equal(isIgnored('output'), false);
    assert.equal(isIgnored('processor.ts'), false);
});
test('createIgnoreMatcher passes through ordinary source paths', () => {
    const isIgnored = createIgnoreMatcher(DEFAULT_IGNORED);
    for (const name of ['src', 'test', 'package.json', 'README.md', 'packages/app/src']) {
        assert.equal(isIgnored(name), false, `expected '${name}' to pass`);
    }
});
test('createIgnoreMatcher with an empty pattern list ignores nothing', () => {
    const isIgnored = createIgnoreMatcher([]);
    assert.equal(isIgnored('node_modules'), false);
    assert.equal(isIgnored('anything'), false);
});
test('createIgnoreMatcher supports a plain-glob pattern (no **/.../** wrapper)', () => {
    const isIgnored = createIgnoreMatcher(['*.log']);
    assert.equal(isIgnored('debug.log'), true);
    assert.equal(isIgnored('debug.txt'), false);
    // A '*' segment does not cross a slash.
    assert.equal(isIgnored('logs/debug.log'), false);
});
test('parseIgnorePatterns wraps bare names and keeps globs and paths verbatim', () => {
    assert.deepEqual(parseIgnorePatterns('coverage\n*.log\nsrc/generated\n'), [
        '**/coverage/**',
        '*.log',
        'src/generated',
    ]);
});
test('parseIgnorePatterns skips blank lines, comments, and negations', () => {
    assert.deepEqual(parseIgnorePatterns('\n# a comment\n   \ntmp\n!keep\n'), ['**/tmp/**']);
});
test('readProjectIgnores returns [] when no ignore file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-lore-ignore-'));
    try {
        assert.deepEqual(readProjectIgnores(dir), []);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('readProjectIgnores reads and parses <root>/.ailoreignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-lore-ignore-'));
    try {
        writeFileSync(join(dir, '.ailoreignore'), '# project ignores\ncoverage\ntmp\n');
        assert.deepEqual(readProjectIgnores(dir), ['**/coverage/**', '**/tmp/**']);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('a parsed user pattern feeds the same matcher as DEFAULT_IGNORED', () => {
    const isIgnored = createIgnoreMatcher(parseIgnorePatterns('coverage'));
    assert.equal(isIgnored('coverage'), true);
    assert.equal(isIgnored('packages/app/coverage'), true);
    assert.equal(isIgnored('coverages'), false);
});
test('isUntrackedFile silences AI-Lore index files', () => {
    assert.equal(isUntrackedFile('memory.index.md'), true);
    assert.equal(isUntrackedFile('status.index.md'), true);
    assert.equal(isUntrackedFile('cockpit-pane-refinements.index.md'), true);
});
test('isUntrackedFile leaves ordinary files tracked', () => {
    // Only `<name>.index.md` is silenced — not a bare `index.md`, not other types.
    assert.equal(isUntrackedFile('status.md'), false);
    assert.equal(isUntrackedFile('A-phase.phase.md'), false);
    assert.equal(isUntrackedFile('contracts.spec.md'), false);
    assert.equal(isUntrackedFile('README.md'), false);
    assert.equal(isUntrackedFile('index.ts'), false);
    assert.equal(isUntrackedFile('index.md'), false);
});
//# sourceMappingURL=ignore.test.js.map