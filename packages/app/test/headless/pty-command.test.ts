import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPtyService } from '../../src/main/pty.js';
import { calls, ptys, resetPtyStub } from './node-pty-stub.js';

// A command panel's PTY (phase M9.5): `opts.command` runs as `$SHELL -i -l -c <command>`
// instead of a plain shell, and `opts.onExit` gets the process's exit code. `node-pty` is
// stubbed for the headless tier (see `node-pty-stub.ts`): no real shell is ever started.

function service() {
  return createPtyService({ cwd: '/tmp', onData: () => {}, onExit: () => {}, onStatus: () => {} });
}

test('a command line spawns "$SHELL -i -l -c <command>"', () => {
  resetPtyStub();
  const svc = service();
  svc.spawn(undefined, { command: 'echo hi' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.args, ['-i', '-l', '-c', 'echo hi']);
  svc.killAll();
});

test('onExit receives the exit code', () => {
  resetPtyStub();
  const svc = service();
  const exits: number[] = [];
  svc.spawn(undefined, { command: 'echo hi', onExit: (exitCode) => exits.push(exitCode) });
  const [pty] = ptys;
  assert.ok(pty);
  pty.finish(3);
  assert.deepEqual(exits, [3]);
  svc.killAll();
});

test("onData is called after the service's own onData", () => {
  resetPtyStub();
  const order: string[] = [];
  const svc = createPtyService({
    cwd: '/tmp',
    onData: () => order.push('service'),
    onExit: () => {},
    onStatus: () => {},
  });
  svc.spawn(undefined, { command: 'echo hi', onData: () => order.push('spawn') });
  const [pty] = ptys;
  assert.ok(pty);
  pty.feedData('hello');
  assert.deepEqual(order, ['service', 'spawn']);
  svc.killAll();
});

test('a plain shell (no engine, no command) is unaffected', () => {
  resetPtyStub();
  const svc = service();
  svc.spawn();
  assert.deepEqual(calls[0]?.args, ['-l']);
  svc.killAll();
});
