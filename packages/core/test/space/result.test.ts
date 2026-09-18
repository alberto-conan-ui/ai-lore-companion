import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type Result, err, errorCode, errorMessage, fail, ok } from '../../src/index.js';

test('ok carries the value', () => {
  const r: Result<number> = ok(3);
  assert.deepEqual(r, { ok: true, value: 3 });
});

test('err carries any error shape', () => {
  const r: Result<number, string[]> = err(['a', 'b']);
  assert.deepEqual(r, { ok: false, error: ['a', 'b'] });
});

test('fail builds a Failure from a kind and a message', () => {
  const r: Result<number> = fail('outside-base', 'x is outside y');
  assert.deepEqual(r, { ok: false, error: { kind: 'outside-base', message: 'x is outside y' } });
});

test('a Result narrows on ok', () => {
  const r: Result<string> = Math.random() >= 0 ? ok('v') : fail('k', 'm');
  if (r.ok) assert.equal(r.value, 'v');
  else assert.fail(r.error.message);
});

test('errorMessage reads an Error and anything else', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('plain'), 'plain');
  assert.equal(errorMessage(42), '42');
});

test('errorCode reads the code of a system error only', () => {
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 2 })), null);
  assert.equal(errorCode(new Error('x')), null);
  assert.equal(errorCode(null), null);
});
