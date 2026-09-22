import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { createPtyService } from '../../src/main/pty.js';
import { calls, ptys, resetPtyStub } from './node-pty-stub.js';

// A command panel's PTY (phase M9.5): `opts.command` runs as `$SHELL -i -l -c <command>`
// instead of a plain shell, and `opts.onExit` gets the process's exit code. `node-pty` is
// stubbed for the headless tier (see `node-pty-stub.ts`): no real shell is ever started.

function service() {
  return createPtyService({ cwd: '/tmp', onData: () => {}, onExit: () => {}, onStatus: () => {} });
}

/**
 * Cleanup that a failing assertion cannot skip.
 *
 * `killAll` used to be the last line of each test, so an assertion that threw
 * left the service's self-rescheduling poll running and the test runner never
 * exited. One stale assertion in this file ran a CI job for six hours instead
 * of failing it.
 */
function serviceFor(t: TestContext): ReturnType<typeof service> {
  const svc = service();
  t.after(() => {
    svc.killAll();
  });
  return svc;
}

test('a command line spawns "$SHELL -i -l -c <command>", with flow control off in the shell', (t) => {
  resetPtyStub();
  const svc = serviceFor(t);
  svc.spawn(undefined, { command: 'echo hi' });
  assert.equal(calls.length, 1);
  // `stty -ixon` turns off the terminal's own XON/XOFF, so Ctrl+S reaches the
  // program instead of stopping output. The PTY's backpressure uses its own
  // tokens and does not need the terminal's.
  assert.deepEqual(calls[0]?.args, ['-i', '-l', '-c', 'stty -ixon; echo hi']);
});

test('onExit receives the exit code', (t) => {
  resetPtyStub();
  const svc = serviceFor(t);
  const exits: number[] = [];
  svc.spawn(undefined, { command: 'echo hi', onExit: (exitCode) => exits.push(exitCode) });
  const [pty] = ptys;
  assert.ok(pty);
  pty.finish(3);
  assert.deepEqual(exits, [3]);
});

test("onData is called after the service's own onData", (t) => {
  resetPtyStub();
  const order: string[] = [];
  const svc = createPtyService({
    cwd: '/tmp',
    onData: () => order.push('service'),
    onExit: () => {},
    onStatus: () => {},
  });
  t.after(() => {
    svc.killAll();
  });
  svc.spawn(undefined, { command: 'echo hi', onData: () => order.push('spawn') });
  const [pty] = ptys;
  assert.ok(pty);
  pty.feedData('hello');
  assert.deepEqual(order, ['service', 'spawn']);
});

test('a plain shell (no engine, no command) is unaffected', (t) => {
  resetPtyStub();
  const svc = serviceFor(t);
  svc.spawn();
  assert.deepEqual(calls[0]?.args, ['-l']);
});
