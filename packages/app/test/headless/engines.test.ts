import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { EngineEntry } from '@ai-lore-companion/core';
import { registerEngines } from '../../src/main/ipc/engines.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

let h: Harness;
let projectRoot: string;
let lorePath: string;

beforeEach(() => {
  h = harnessFor(registerEngines);
  projectRoot = mkdtempSync(join(tmpdir(), 'cockpit-proj-'));
  lorePath = join(projectRoot, '.ai-lore-proj');
  h.setCtx(fakeContext({ root: projectRoot, lorePath }));
});

afterEach(() => {
  h.cleanup();
  rmSync(projectRoot, { recursive: true, force: true });
});

const fake: EngineEntry = { id: 'fake', name: 'Fake', binary: '/usr/bin/true' };

test('enginesSave persists, returns the list, and broadcasts', () => {
  const result = h.invoke('enginesSave', [fake]) as EngineEntry[];
  assert.ok(Array.isArray(result));
  assert.ok(
    result.some((e) => e.id === 'fake' && e.binary === '/usr/bin/true'),
    'saved engine round-trips through the store',
  );
  assert.equal(h.broadcasts.engines.calls.length, 1, 'broadcastEngines fired once');
  assert.deepEqual(h.broadcasts.engines.calls[0]?.[0], result, 'broadcast carries the new list');
});

test('enginesList reads back what enginesSave wrote', () => {
  h.invoke('enginesSave', [fake]);
  const list = h.invoke('enginesList') as EngineEntry[];
  assert.ok(Array.isArray(list));
  assert.ok(list.some((e) => e.id === 'fake'));
});

test('enginesSave drops malformed raw entries (parse gate)', () => {
  const result = h.invoke('enginesSave', [
    fake,
    { id: '', name: 'x' },
    { nope: 1 },
  ]) as EngineEntry[];
  assert.ok(result.every((e) => e.id.length > 0 && e.name.length > 0 && e.binary.length > 0));
  assert.ok(result.some((e) => e.id === 'fake'));
});

test('engineLastSet then engineLastGet round-trips per project', () => {
  h.invoke('engineLastSet', 'fake');
  assert.equal(h.invoke('engineLastGet'), 'fake');
});

test('engineLastSet ignores a non-string / empty id', () => {
  h.invoke('engineLastSet', '');
  h.invoke('engineLastSet', 42);
  assert.equal(h.invoke('engineLastGet'), null);
});

test('engineLastGet returns null with no project context', () => {
  h.setCtx(undefined);
  assert.equal(h.invoke('engineLastGet'), null);
});

test('aiPromptsWidthSet then aiPromptsWidthGet round-trips', () => {
  h.invoke('aiPromptsWidthSet', 320);
  assert.equal(h.invoke('aiPromptsWidthGet'), 320);
});

test('aiPromptsWidthSet ignores a non-finite width', () => {
  h.invoke('aiPromptsWidthSet', Number.NaN);
  assert.equal(h.invoke('aiPromptsWidthGet'), null);
});

test('promptsList returns [] with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('promptsList'), []);
});

test('engineBindingInstalled is false on the plain-text path (no .claude/skills)', () => {
  assert.equal(h.invoke('engineBindingInstalled'), false);
});

test('engineBindingInstalled is true once an ai-lore-* skill is present', () => {
  mkdirSync(join(projectRoot, '.claude', 'skills', 'ai-lore-orient'), { recursive: true });
  assert.equal(h.invoke('engineBindingInstalled'), true);
});

test('engineBindingInstalled is false when .claude/skills holds only non-ai-lore skills', () => {
  mkdirSync(join(projectRoot, '.claude', 'skills', 'some-other-skill'), { recursive: true });
  assert.equal(h.invoke('engineBindingInstalled'), false);
});

test('engineBindingInstalled is false with no project context', () => {
  h.setCtx(undefined);
  assert.equal(h.invoke('engineBindingInstalled'), false);
});
