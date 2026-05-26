import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildDiffArgv, templateUsesBothPlaceholders } from '../src/index.js';

test('buildDiffArgv substitutes both placeholders', () => {
  const argv = buildDiffArgv({
    template: '{baseline} {current}',
    baseline: '/tmp/old.ts',
    current: '/work/new.ts',
  });
  assert.deepEqual(argv, ['/tmp/old.ts', '/work/new.ts']);
});

test('buildDiffArgv preserves literal flag tokens around the placeholders', () => {
  const argv = buildDiffArgv({
    template: '--diff {baseline} {current}',
    baseline: '/tmp/old.ts',
    current: '/work/new.ts',
  });
  assert.deepEqual(argv, ['--diff', '/tmp/old.ts', '/work/new.ts']);
});

test('buildDiffArgv collapses runs of whitespace in the template', () => {
  const argv = buildDiffArgv({
    template: '  --diff    {baseline}    {current}  ',
    baseline: '/tmp/old.ts',
    current: '/work/new.ts',
  });
  assert.deepEqual(argv, ['--diff', '/tmp/old.ts', '/work/new.ts']);
});

test('buildDiffArgv handles a missing placeholder by simply not substituting it', () => {
  const argv = buildDiffArgv({
    template: '{current}',
    baseline: '/tmp/old.ts',
    current: '/work/new.ts',
  });
  assert.deepEqual(argv, ['/work/new.ts']);
});

test('buildDiffArgv does not split paths containing spaces (paths are argv elements)', () => {
  const argv = buildDiffArgv({
    template: '{baseline} {current}',
    baseline: '/tmp/has space.ts',
    current: '/work/new.ts',
  });
  assert.deepEqual(argv, ['/tmp/has space.ts', '/work/new.ts']);
});

test('buildDiffArgv does not shell-interpret metacharacters in paths', () => {
  // The argv array is passed directly to spawn; metacharacters never reach a shell.
  const argv = buildDiffArgv({
    template: '{baseline} {current}',
    baseline: '/tmp/`whoami`.ts',
    current: '/work/$(ls).ts',
  });
  assert.deepEqual(argv, ['/tmp/`whoami`.ts', '/work/$(ls).ts']);
});

test('templateUsesBothPlaceholders is true for a template that references both', () => {
  assert.equal(templateUsesBothPlaceholders('--diff {baseline} {current}'), true);
});

test('templateUsesBothPlaceholders is false when one placeholder is missing', () => {
  assert.equal(templateUsesBothPlaceholders('--diff {baseline}'), false);
  assert.equal(templateUsesBothPlaceholders('--diff {current}'), false);
});

test('templateUsesBothPlaceholders is false for a template with neither', () => {
  assert.equal(templateUsesBothPlaceholders('--diff'), false);
  assert.equal(templateUsesBothPlaceholders(''), false);
});
