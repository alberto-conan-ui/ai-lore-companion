import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { z } from 'zod';
import type { RegisterModule } from '../../../src/main/ipc/types.js';
import { type SpaceContext, defineSpaceService } from '../../../src/main/space/context.js';
import type { SpaceIpcEvent } from '../../../src/main/space/host.js';
import { parseArg, rootIdSchema } from '../../../src/main/space/ipc/validate.js';
import { invoke } from '../../../src/shared/ipc/space/describe.js';
import { LORE_TEMPLATE_DIR, spaceHarnessFor } from './space-harness.js';

// What a later phase does to add a channel with per-Space state, done here with throwaway
// names and no edit to a shared file: an entry built with `describe.ts` (it would go in the
// phase's own fragment), a service declared with `defineSpaceService`, and a handler that
// checks where the call came from and validates its argument. That a fragment's entries
// reach `CONTRACT`, and so the preload bridge and the registrar, is `groundwork.test.ts`.

const THROWAWAY_FRAGMENT = {
  spaceThrowawayCount: invoke<[arg: { rootId: string }], unknown>('space:throwaway-count'),
} as const;

const counter = defineSpaceService({
  id: 'throwaway-counter',
  create: (context: SpaceContext) => ({ space: context.key, counts: new Map<string, number>() }),
  dispose: (service) => service.counts.clear(),
});

const schema = z.strictObject({ rootId: rootIdSchema });

type LooseRegistrar = {
  handle(key: string, handler: (event: SpaceIpcEvent, arg: unknown) => unknown): void;
};

const registerThrowaway: RegisterModule = (reg, deps) => {
  (reg as unknown as LooseRegistrar).handle('spaceThrowawayCount', (event, arg) => {
    const context = deps.space.contextFor(event);
    if (!context) return { ok: false, error: { kind: 'not-a-space-window', message: 'refused' } };
    const parsed = parseArg(schema, arg);
    if (!parsed.ok) return parsed;
    const service = context.service(counter);
    const next = (service.counts.get(parsed.value.rootId) ?? 0) + 1;
    service.counts.set(parsed.value.rootId, next);
    return { ok: true, value: { space: service.space, count: next } };
  });
};

let space: SpaceFixture;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'recipe-space' });
});

after(() => space.cleanup());

test('a new channel with a per-Space service needs only its own files', async () => {
  assert.match(THROWAWAY_FRAGMENT.spaceThrowawayCount.channel, /^space:/);
  const h = spaceHarnessFor(registerThrowaway);
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    h.space.host.openFilesWindow(context);
    const filesWindow = h.space.created[1];
    assert.ok(filesWindow);

    // Both windows of the Space reach the same service.
    assert.deepEqual(await h.invoke('spaceThrowawayCount', spaceWindow, { rootId: 'lore' }), {
      ok: true,
      value: { space: context.key, count: 1 },
    });
    assert.deepEqual(await h.invoke('spaceThrowawayCount', filesWindow, { rootId: 'lore' }), {
      ok: true,
      value: { space: context.key, count: 2 },
    });

    const invalid = (await h.invoke('spaceThrowawayCount', spaceWindow, {
      rootId: '../lore',
    })) as { ok: boolean; error?: { kind: string } };
    assert.equal(invalid.error?.kind, 'invalid-argument');

    const stranger = (await h.invoke(
      'spaceThrowawayCount',
      { webContentsId: 987654 },
      { rootId: 'lore' },
    )) as { ok: boolean };
    assert.equal(stranger.ok, false);

    // The service ends with the last window of the Space.
    const service = context.service(counter);
    await h.space.host.windowClosed(spaceWindow.id);
    assert.equal(service.counts.size, 1, 'the Files window still holds the Space');
    await h.space.host.windowClosed(filesWindow.id);
    assert.equal(service.counts.size, 0, 'disposed with the context');
  } finally {
    h.cleanup();
  }
});
