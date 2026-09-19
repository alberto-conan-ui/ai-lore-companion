import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GH_WEB_SIGN_IN_COMMAND } from '@ai-lore-companion/core';
import type { PtyService, PtySpawnOpts } from '../../../src/main/pty.js';
import { createSpaceCommandsRegister } from '../../../src/main/space/ipc/commands.js';
import { SPACE_COMMANDS_CONTRACT } from '../../../src/shared/ipc/space/commands.contract.js';
import type { SpaceCommandRunResult } from '../../../src/shared/ipc/space/commands.types.js';
import { type FakeSpaceWindow, type SpaceHarness, spaceHarnessFor } from './space-harness.js';

// The command panel's channel: a fixed command id runs in the window's own terminal, and the
// device code and the exit code found in its output are pushed back. No real command is ever
// started here — the PTY service is a fake the test drives by hand.

/** A PTY service stand-in: `spawn` never starts a shell; it records what it was asked to run
 *  and hands the test the callbacks it was given, so it can feed data and an exit code. */
function fakePtyService(): { service: PtyService; calls: PtySpawnOpts[] } {
  const calls: PtySpawnOpts[] = [];
  let nextId = 0;
  const service: PtyService = {
    spawn: (_engine, opts) => {
      calls.push(opts ?? {});
      nextId += 1;
      return `pty-${nextId}`;
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
    killAll: () => {},
    hasRunningTask: () => false,
  };
  return { service, calls };
}

let h: SpaceHarness;

afterEach(() => h.cleanup());

/** The welcome window, shown fresh through the real host. */
function welcomeWindow(): FakeSpaceWindow {
  h.space.host.openWelcome();
  const [window] = h.space.created;
  assert.ok(window);
  return window;
}

/** The same window, moved to Set up this computer. */
async function machineCheckWindow(): Promise<FakeSpaceWindow> {
  const window = welcomeWindow();
  await h.space.host.navigate(window, { to: 'machine-check' });
  return window;
}

/** The same window, moved to the setup screen. */
async function setupWindow(): Promise<FakeSpaceWindow> {
  const window = welcomeWindow();
  await h.space.host.navigate(window, { to: 'setup', start: 'new' });
  return window;
}

test('refused from a window that is not one of the runnable screens', () => {
  const { service } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = welcomeWindow();
  const result = h.invoke('spaceCommandRun', window, {
    commandId: 'github-sign-in',
  }) as SpaceCommandRunResult;
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'not-allowed-here');
});

test('unknown-command for a command id that is not one of setupCommands()', async () => {
  const { service } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = await machineCheckWindow();
  const result = h.invoke('spaceCommandRun', window, {
    commandId: 'rm -rf /',
  }) as SpaceCommandRunResult;
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'unknown-command');
});

test('no-terminal when the window has no PTY service to run in', async () => {
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => undefined }));
  const window = await machineCheckWindow();
  const result = h.invoke('spaceCommandRun', window, {
    commandId: 'github-sign-in',
  }) as SpaceCommandRunResult;
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'no-terminal');
});

test('from a machine-check window, spawn receives the command line of the id', async () => {
  const { service, calls } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = await machineCheckWindow();
  const result = h.invoke('spaceCommandRun', window, {
    commandId: 'github-sign-in',
  }) as SpaceCommandRunResult;
  assert.ok(result.ok);
  assert.equal(result.value.commandId, 'github-sign-in');
  assert.equal(result.value.commandLine, GH_WEB_SIGN_IN_COMMAND);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, GH_WEB_SIGN_IN_COMMAND);
});

test('also runs from the setup screen', async () => {
  const { service, calls } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = await setupWindow();
  const result = h.invoke('spaceCommandRun', window, {
    commandId: 'github-sign-in',
  }) as SpaceCommandRunResult;
  assert.ok(result.ok);
  assert.equal(calls.length, 1);
});

test('a one-time code found in the output is pushed once; the same text again pushes nothing', async () => {
  const { service, calls } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = await machineCheckWindow();
  h.invoke('spaceCommandRun', window, { commandId: 'github-sign-in' });
  const onData = calls[0]?.onData;
  assert.ok(onData);
  const line = '! First copy your one-time code: 1A2B-3C4D\r\n';
  onData(line);
  onData(line);
  const codes = window.sent.filter(
    (m) => m.channel === SPACE_COMMANDS_CONTRACT.onSpaceCommandCode.channel,
  );
  assert.equal(codes.length, 1);
  assert.deepEqual(codes[0]?.payload, { ptyId: 'pty-1', code: '1A2B-3C4D' });
});

test('the exit code is pushed when the command ends', async () => {
  const { service, calls } = fakePtyService();
  h = spaceHarnessFor(createSpaceCommandsRegister({ spawn: () => service }));
  const window = await machineCheckWindow();
  h.invoke('spaceCommandRun', window, { commandId: 'github-sign-in' });
  const onExit = calls[0]?.onExit;
  assert.ok(onExit);
  onExit(1);
  const exits = window.sent.filter(
    (m) => m.channel === SPACE_COMMANDS_CONTRACT.onSpaceCommandExit.channel,
  );
  assert.equal(exits.length, 1);
  assert.deepEqual(exits[0]?.payload, { ptyId: 'pty-1', commandId: 'github-sign-in', exitCode: 1 });
});
