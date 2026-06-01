import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeUrl } from '../src/index.js';

test('normalizeUrl keeps an explicit scheme untouched', () => {
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('http://localhost:3000/x'), 'http://localhost:3000/x');
});

test('normalizeUrl navigates loopback hosts over http (the localhost fix)', () => {
  assert.equal(normalizeUrl('localhost'), 'http://localhost');
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('127.0.0.1:8080/api'), 'http://127.0.0.1:8080/api');
});

test('normalizeUrl treats a bare dot-less host:port as an http dev server', () => {
  assert.equal(normalizeUrl('api:8080'), 'http://api:8080');
});

test('normalizeUrl sends dotted domains to https', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('sub.example.co/path'), 'https://sub.example.co/path');
});

test('normalizeUrl turns non-URL text into a Google search', () => {
  assert.equal(
    normalizeUrl('how to center a div'),
    'https://www.google.com/search?q=how%20to%20center%20a%20div',
  );
});

test('normalizeUrl returns empty for blank input (caller substitutes home)', () => {
  assert.equal(normalizeUrl('   '), '');
});
