import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { deskPaths, takeDeskOwnership } from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { registerSpaceUi } from '../../../src/main/space/ipc/ui.js';
import { UI_FILES, spaceUi } from '../../../src/main/space/ui-store.js';
import {
  boundsConcernFor,
  restoreWindowBounds,
  trackWindowBounds,
} from '../../../src/main/space/window-bounds.js';
import { SPACE_UI_CONTRACT } from '../../../src/shared/ipc/space/ui.contract.js';
import type {
  SpaceUiRead,
  SpaceUiResult,
  SpaceUiSaved,
} from '../../../src/shared/ipc/space/ui.types.js';
import { type FakeSpaceWindow, LORE_TEMPLATE_DIR, spaceHarnessFor } from './space-harness.js';

// Phase M5.7: what a Space's windows remember, one file per concern under
// `<userData>/spaces/<key>/ui/`, read and saved for the calling Files window's Space.

let space: SpaceFixture;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'ui-space' });
});

after(() => space.cleanup());

type Opened = {
  h: ReturnType<typeof spaceHarnessFor>;
  spaceWindow: FakeSpaceWindow;
  filesWindow: FakeSpaceWindow;
  context: SpaceContext;
  ui: string;
};

async function open(): Promise<Opened> {
  const h = spaceHarnessFor(registerSpaceUi);
  await h.space.host.openFolder(undefined, space.root);
  const spaceWindow = h.space.created[0];
  assert.ok(spaceWindow);
  const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(context);
  h.space.host.openFilesWindow(context);
  const filesWindow = h.space.created[1];
  assert.ok(filesWindow);
  return {
    h,
    spaceWindow,
    filesWindow,
    context,
    ui: deskPaths(h.space.userDataDir, space.root).ui,
  };
}

async function close(o: Opened): Promise<void> {
  await o.h.space.host.dispose();
  o.h.cleanup();
}

const EDITOR = {
  version: 1 as const,
  docs: [
    {
      rootId: 'lore',
      path: 'ai_readme.md',
      mode: 'preview' as const,
      pin: null,
      against: null,
      atCommit: null,
    },
    {
      rootId: 'repo:app',
      path: 'src/a.ts',
      mode: 'diff' as const,
      pin: {
        kind: 'commit' as const,
        commit: 'b'.repeat(40),
        at: '2026-09-10T09:00:00Z',
        label: 'Older',
      },
      against: null,
      atCommit: null,
    },
  ],
  activeKey: JSON.stringify(['repo:app', 'src/a.ts']),
};

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

test('the channels are in the Files window fragment and named for a Space', () => {
  assert.equal(SPACE_UI_CONTRACT.spaceUiRead.channel, 'space:ui-read');
  assert.equal(SPACE_UI_CONTRACT.spaceUiSave.channel, 'space:ui-save');
});

test('a save from the Files window is written to its own file, versioned, and read back', async () => {
  const o = await open();
  try {
    const saved = (await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'files-editor',
      state: EDITOR,
    })) as SpaceUiResult<SpaceUiSaved>;
    assert.deepEqual(saved, { ok: true, value: { outcome: 'scheduled' } });
    // Pending state is what a read gives before the write.
    const pending = (await o.h.invoke('spaceUiRead', o.filesWindow, {
      concern: 'files-editor',
    })) as SpaceUiResult<SpaceUiRead>;
    assert.ok(pending.ok);
    assert.deepEqual(pending.value.state, EDITOR);

    for (const [concern, state] of [
      ['selected-root', { version: 1, rootId: 'repo:app' }],
      ['baselines', { version: 1, roots: { lore: 'c'.repeat(40) } }],
    ] as const) {
      const r = (await o.h.invoke('spaceUiSave', o.filesWindow, { concern, state })) as {
        ok: boolean;
      };
      assert.ok(r.ok);
    }
    o.context.service(spaceUi).flush();
    assert.deepEqual(readJson(join(o.ui, UI_FILES['files-editor'])), EDITOR);
    assert.deepEqual(readJson(join(o.ui, UI_FILES['selected-root'])), {
      version: 1,
      rootId: 'repo:app',
    });
    assert.deepEqual(readJson(join(o.ui, UI_FILES.baselines)), {
      version: 1,
      roots: { lore: 'c'.repeat(40) },
    });
    // No content and no absolute path is in what is remembered.
    assert.ok(!readFileSync(join(o.ui, UI_FILES['files-editor']), 'utf8').includes(space.root));
  } finally {
    await close(o);
  }
});

test('what is pending is written when the Space closes, and read by the next open', async () => {
  const o = await open();
  const userData = o.h.space.userDataDir;
  try {
    await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'lore' },
    });
    await o.h.space.host.windowClosed(o.filesWindow.id);
    await o.h.space.host.windowClosed(o.spaceWindow.id);
    assert.deepEqual(readJson(join(deskPaths(userData, space.root).ui, 'selected-root.json')), {
      version: 1,
      rootId: 'lore',
    });
    // Opened again: the read gives it back.
    await o.h.space.host.openFolder(undefined, space.root);
    const again = o.h.space.created[2];
    assert.ok(again);
    const context = o.h.space.host.contextFor({ sender: { id: again.webContents.id } });
    assert.ok(context);
    o.h.space.host.openFilesWindow(context);
    const files = o.h.space.created[3];
    assert.ok(files);
    const read = (await o.h.invoke('spaceUiRead', files, {
      concern: 'selected-root',
    })) as SpaceUiResult<SpaceUiRead>;
    assert.deepEqual(read, {
      ok: true,
      value: { state: { version: 1, rootId: 'lore' }, notice: null },
    });
  } finally {
    await close(o);
  }
});

test('fields this build does not know are kept', async () => {
  const o = await open();
  try {
    mkdirSync(o.ui, { recursive: true });
    writeFileSync(
      join(o.ui, 'selected-root.json'),
      JSON.stringify({ version: 1, rootId: 'lore', laterField: { a: 1 } }),
    );
    const read = (await o.h.invoke('spaceUiRead', o.filesWindow, {
      concern: 'selected-root',
    })) as SpaceUiResult<SpaceUiRead>;
    assert.ok(read.ok);
    assert.equal((read.value.state as { rootId: string }).rootId, 'lore');
    await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'repo:app' },
    });
    o.context.service(spaceUi).flush();
    assert.deepEqual(readJson(join(o.ui, 'selected-root.json')), {
      version: 1,
      rootId: 'repo:app',
      laterField: { a: 1 },
    });
  } finally {
    await close(o);
  }
});

test('a corrupt file is set aside and the window opens with defaults and a notice', async () => {
  const o = await open();
  try {
    mkdirSync(o.ui, { recursive: true });
    writeFileSync(join(o.ui, 'files-editor.json'), '{ not json');
    writeFileSync(
      join(o.ui, 'baselines.json'),
      JSON.stringify({ version: 1, roots: { lore: 'not a commit' } }),
    );
    for (const concern of ['files-editor', 'baselines'] as const) {
      const read = (await o.h.invoke('spaceUiRead', o.filesWindow, {
        concern,
      })) as SpaceUiResult<SpaceUiRead>;
      assert.ok(read.ok);
      assert.equal(read.value.state, null);
      assert.match(
        read.value.notice ?? '',
        /could not be read .* It was set aside as .*\.corrupt-/,
      );
    }
    const names = readdirSync(o.ui);
    assert.ok(names.some((name) => name.startsWith('files-editor.json.corrupt-')));
    assert.ok(names.some((name) => name.startsWith('baselines.json.corrupt-')));
    assert.ok(!existsSync(join(o.ui, 'files-editor.json')));
  } finally {
    await close(o);
  }
});

test('a file a newer build wrote is left as it is: not read, not written', async () => {
  const o = await open();
  try {
    mkdirSync(o.ui, { recursive: true });
    const newer = JSON.stringify({ version: 2, rootId: 'lore', shape: 'new' });
    writeFileSync(join(o.ui, 'selected-root.json'), newer);
    const read = (await o.h.invoke('spaceUiRead', o.filesWindow, {
      concern: 'selected-root',
    })) as SpaceUiResult<SpaceUiRead>;
    assert.ok(read.ok);
    assert.equal(read.value.state, null);
    assert.match(read.value.notice ?? '', /written by a newer build/);
    const saved = (await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'repo:app' },
    })) as SpaceUiResult<SpaceUiSaved>;
    assert.deepEqual(saved, { ok: true, value: { outcome: 'not-writable' } });
    o.context.service(spaceUi).flush();
    assert.equal(readFileSync(join(o.ui, 'selected-root.json'), 'utf8'), newer);
  } finally {
    await close(o);
  }
});

test('only the focused window writes: a save while the Space window has the focus is not taken', async () => {
  const o = await open();
  try {
    o.spaceWindow.isFocused = () => true;
    const refused = (await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'lore' },
    })) as SpaceUiResult<SpaceUiSaved>;
    assert.deepEqual(refused, { ok: true, value: { outcome: 'not-focused' } });
    o.spaceWindow.isFocused = () => false;
    o.filesWindow.isFocused = () => true;
    const taken = (await o.h.invoke('spaceUiSave', o.filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'lore' },
    })) as SpaceUiResult<SpaceUiSaved>;
    assert.deepEqual(taken, { ok: true, value: { outcome: 'scheduled' } });
  } finally {
    await close(o);
  }
});

test('the channels answer only the Files window, and check the argument', async () => {
  const o = await open();
  try {
    for (const sender of [o.spaceWindow, { webContentsId: 987654 }]) {
      const r = (await o.h.invoke('spaceUiRead', sender, { concern: 'files-editor' })) as {
        ok: boolean;
        error?: { kind: string };
      };
      assert.equal(r.error?.kind, 'not-a-space-window');
    }
    const frame = (await o.h.invoke(
      'spaceUiRead',
      { webContentsId: o.filesWindow.webContents.id, frame: 'inside-the-page' },
      { concern: 'files-editor' },
    )) as { ok: boolean };
    assert.equal(frame.ok, false);
    const bad = [{ concern: 'space-window' }, { concern: 'files-editor', extra: 1 }];
    for (const arg of bad) {
      const r = (await o.h.invoke('spaceUiRead', o.filesWindow, arg)) as {
        error?: { kind: string };
      };
      assert.equal(r.error?.kind, 'invalid-argument');
    }
    const absolute = {
      ...EDITOR,
      docs: [{ ...EDITOR.docs[0], path: '/etc/passwd' }],
    };
    const badSaves = [
      { concern: 'files-editor', state: absolute },
      { concern: 'files-editor', state: { ...EDITOR, version: 2 } },
      // A field the renderer is not meant to send (a file's content) is refused.
      { concern: 'files-editor', state: { ...EDITOR, docs: [{ ...EDITOR.docs[0], text: 'x' }] } },
      { concern: 'selected-root', state: { version: 1, rootId: 'lore', abs: '/Users/x' } },
      { concern: 'selected-root', state: { version: 1, rootId: '../x' } },
      { concern: 'baselines', state: { version: 1, roots: { lore: 'main; rm -rf' } } },
      { concern: 'space-window', state: { version: 1, x: 0, y: 0, width: 800, height: 600 } },
    ];
    for (const arg of badSaves) {
      const r = (await o.h.invoke('spaceUiSave', o.filesWindow, arg)) as {
        error?: { kind: string };
      };
      assert.equal(r.error?.kind, 'invalid-argument', JSON.stringify(arg));
    }
  } finally {
    await close(o);
  }
});

test('a second running instance that does not own the desk writes nothing', async () => {
  const holder: ChildProcess = spawn('sleep', ['60'], { stdio: 'ignore' });
  const h = spaceHarnessFor(registerSpaceUi);
  try {
    assert.ok(holder.pid);
    const paths = deskPaths(h.space.userDataDir, space.root);
    const owned = takeDeskOwnership(paths.desk, {
      pid: holder.pid as number,
      startedAt: new Date().toISOString(),
    });
    assert.ok(owned.ok && owned.value.owned);
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    h.space.host.openFilesWindow(context);
    const filesWindow = h.space.created[1];
    assert.ok(filesWindow);
    const saved = (await h.invoke('spaceUiSave', filesWindow, {
      concern: 'selected-root',
      state: { version: 1, rootId: 'lore' },
    })) as SpaceUiResult<SpaceUiSaved>;
    assert.deepEqual(saved, { ok: true, value: { outcome: 'not-writable' } });
    // A corrupt file is reported and left where it is.
    mkdirSync(paths.ui, { recursive: true });
    writeFileSync(join(paths.ui, 'baselines.json'), 'nope');
    const read = (await h.invoke('spaceUiRead', filesWindow, {
      concern: 'baselines',
    })) as SpaceUiResult<SpaceUiRead>;
    assert.ok(read.ok);
    assert.match(read.value.notice ?? '', /opens with defaults/);
    assert.equal(readFileSync(join(paths.ui, 'baselines.json'), 'utf8'), 'nope');
    context.service(spaceUi).flush();
    assert.ok(!existsSync(join(paths.ui, 'selected-root.json')));
  } finally {
    await h.space.host.dispose();
    h.cleanup();
    holder.kill();
  }
});

test('window positions: restored from their file, saved on a move, per window', async () => {
  const o = await open();
  try {
    assert.equal(boundsConcernFor('space'), 'space-window');
    assert.equal(boundsConcernFor('space-files'), 'files-window');
    assert.equal(boundsConcernFor('space-welcome'), null);
    let rect = { x: 10, y: 20, width: 900, height: 700 };
    const set: (typeof rect)[] = [];
    let moved: () => void = () => undefined;
    const bounds = {
      get: () => rect,
      set: (next: typeof rect) => set.push(next),
      onChange: (listener: () => void) => {
        moved = listener;
      },
    };
    restoreWindowBounds(bounds, o.context, 'files-window');
    assert.deepEqual(set, [], 'nothing saved, nothing set');
    trackWindowBounds(bounds, () => ({ context: o.context, concern: 'files-window' }));
    rect = { x: 30.4, y: 40, width: 1000, height: 800 };
    moved();
    o.context.service(spaceUi).flush();
    assert.deepEqual(readJson(join(o.ui, 'files-window.json')), {
      version: 1,
      x: 30,
      y: 40,
      width: 1000,
      height: 800,
    });
    restoreWindowBounds(bounds, o.context, 'files-window');
    assert.deepEqual(set, [{ x: 30, y: 40, width: 1000, height: 800 }]);
    assert.ok(!existsSync(join(o.ui, 'space-window.json')));
  } finally {
    await close(o);
  }
});
