import test from 'node:test';
import assert from 'node:assert/strict';
import type { RecentProject, WindowInitPayload } from '../../src/shared/ipc.js';
import { createWindowInitReplay } from '../../src/preload/window-init-replay.js';

const welcome = (recents: RecentProject[]): WindowInitPayload => ({ mode: 'welcome', recents });
const cockpit: WindowInitPayload = { mode: 'cockpit' };

test('a payload received before subscribe is replayed immediately', () => {
  const replay = createWindowInitReplay();
  replay.receive(welcome([{ path: '/first', openedAt: 1 }]));

  const received: WindowInitPayload[] = [];
  replay.subscribe((payload) => received.push(payload));

  assert.deepEqual(received, [welcome([{ path: '/first', openedAt: 1 }])]);
});

test('a subscriber receives each future payload once', () => {
  const replay = createWindowInitReplay();
  const received: WindowInitPayload[] = [];
  replay.subscribe((payload) => received.push(payload));

  replay.receive(welcome([{ path: '/first', openedAt: 1 }]));
  replay.receive(cockpit);

  assert.deepEqual(received, [welcome([{ path: '/first', openedAt: 1 }]), cockpit]);
});

test('a replacement payload is replayed and unsubscribe stops future updates', () => {
  const replay = createWindowInitReplay();
  replay.receive(welcome([{ path: '/first', openedAt: 1 }]));
  replay.receive(welcome([{ path: '/replacement', openedAt: 2 }]));

  const received: WindowInitPayload[] = [];
  const unsubscribe = replay.subscribe((payload) => received.push(payload));
  unsubscribe();
  replay.receive(cockpit);

  assert.deepEqual(received, [welcome([{ path: '/replacement', openedAt: 2 }])]);
});

test('a fresh helper instance does not replay another instance payload', () => {
  const first = createWindowInitReplay();
  first.receive(cockpit);

  const second = createWindowInitReplay();
  const received: WindowInitPayload[] = [];
  second.subscribe((payload) => received.push(payload));

  assert.deepEqual(received, []);
});
