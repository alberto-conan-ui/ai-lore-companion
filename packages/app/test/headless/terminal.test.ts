import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { registerTerminal } from '../../src/main/ipc/terminal.js';
import { type FakePty, type Harness, fakeContext, fakePtyService, harnessFor } from './harness.js';

let h: Harness;
let pty: FakePty;

beforeEach(() => {
  h = harnessFor(registerTerminal);
  pty = fakePtyService('pty-7');
  h.setCtx(fakeContext({ root: '/proj', lorePath: '/proj/.ai-lore-proj', ptyService: pty }));
});

afterEach(() => {
  h.cleanup();
});

test('spawnTerminal spawns via the context ptyService and returns its id', () => {
  assert.equal(h.invoke('spawnTerminal'), 'pty-7');
  assert.equal(pty.spawnCalls.length, 1);
  assert.equal(pty.spawnCalls[0]?.engine, undefined, 'plain shell spawn carries no engine');
});

test('spawnTerminal returns "" with no project context', () => {
  h.setCtx(undefined);
  assert.equal(h.invoke('spawnTerminal'), '');
});

test('spawnTerminalEngine passes binary + args through to ptyService.spawn', () => {
  const id = h.invoke('spawnTerminalEngine', { binary: 'claude', args: ['--foo'] });
  assert.equal(id, 'pty-7');
  assert.deepEqual(pty.spawnCalls[0]?.engine, { binary: 'claude', args: ['--foo'] });
});

test('spawnTerminalEngine returns "" with no project context', () => {
  h.setCtx(undefined);
  assert.equal(h.invoke('spawnTerminalEngine', { binary: 'claude' }), '');
});

test('sendTerminalInput writes the data to the addressed pty', () => {
  h.invoke('sendTerminalInput', { id: 'pty-7', data: 'ls\n' });
  assert.deepEqual(pty.write.calls, [['pty-7', 'ls\n']]);
});

test('resizeTerminal forwards cols + rows', () => {
  h.invoke('resizeTerminal', { id: 'pty-7', cols: 120, rows: 40 });
  assert.deepEqual(pty.resize.calls, [['pty-7', 120, 40]]);
});

test('killTerminal forwards the id', () => {
  h.invoke('killTerminal', 'pty-7');
  assert.deepEqual(pty.kill.calls, [['pty-7']]);
});

test('input/resize/kill are no-ops with no project context', () => {
  h.setCtx(undefined);
  h.invoke('sendTerminalInput', { id: 'pty-7', data: 'x' });
  h.invoke('resizeTerminal', { id: 'pty-7', cols: 1, rows: 1 });
  h.invoke('killTerminal', 'pty-7');
  assert.equal(pty.write.calls.length, 0);
  assert.equal(pty.resize.calls.length, 0);
  assert.equal(pty.kill.calls.length, 0);
});
