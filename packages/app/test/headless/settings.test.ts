import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { WorkspaceLayout } from '@ai-lore-companion/core';
import { WORKSPACE_LAYOUT_SCHEMA_VERSION } from '@ai-lore-companion/core';
import { registerSettings } from '../../src/main/ipc/settings.js';
import { loadProjectSettings } from '../../src/main/settings.js';
import { resetElectronStub } from './electron-stub.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

/** A minimal valid layout snapshot — one dormant shell in the centre panel. */
function sampleLayout(): WorkspaceLayout {
  const empty = { tabs: [], activeId: '' };
  return {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    panels: {
      leftRail: { tabs: [], activeId: 'status' },
      centre: {
        tabs: [
          {
            id: 't1',
            kind: 'shell',
            title: 'Shell 1',
            lastSession: { kind: 'shell', detail: 'vi' },
          },
        ],
        activeId: 't1',
      },
      right: empty,
      leftRailBottom: empty,
      centreBottom: empty,
      rightBottom: empty,
    },
    rightOpen: true,
    leftRailBottomOpen: false,
    centreBottomOpen: false,
    rightBottomOpen: false,
    leftRailWidth: 400,
    rightWidth: 480,
    leftRailBottomHeight: 240,
    centreBottomHeight: 240,
    rightBottomHeight: 240,
  };
}

let h: Harness;
let root: string;
let lorePath: string;

beforeEach(() => {
  resetElectronStub();
  h = harnessFor(registerSettings);
  root = mkdtempSync(join(tmpdir(), 'cockpit-settings-'));
  lorePath = join(root, '.ai-lore-proj');
  mkdirSync(join(lorePath, 'memory', 'status'), { recursive: true });
  h.setCtx(fakeContext({ root, lorePath }));
});

afterEach(() => {
  h.cleanup();
  rmSync(root, { recursive: true, force: true });
});

test('settingsGet returns the snapshot', () => {
  assert.equal(h.invoke('settingsGet'), h.settingsSnapshot);
});

test('settingsSet rejects an unknown key without persisting or broadcasting', () => {
  const result = h.invoke('settingsSet', { tier: 'global', key: '__nope__', value: 1 });
  assert.equal(result, h.settingsSnapshot);
  assert.equal(h.broadcasts.settings.calls.length, 0);
});

test('settingsSetIgnores broadcasts and returns the snapshot', () => {
  const result = h.invoke('settingsSetIgnores', { tier: 'global', rules: [] });
  assert.equal(result, h.settingsSnapshot);
  assert.equal(h.broadcasts.settings.calls.length, 1);
});

test('settingsSetLayout persists the snapshot to the project tier, no broadcast', () => {
  const layout = sampleLayout();
  h.invoke('settingsSetLayout', { layout });
  const stored = loadProjectSettings(h.userDataDir, root).layout;
  assert.equal(stored?.panels.centre.tabs[0]?.lastSession?.detail, 'vi');
  assert.equal(stored?.rightOpen, true);
  // The snapshot is the writing window's own state — no SettingsChanged push.
  assert.equal(h.broadcasts.settings.calls.length, 0);
});

test('settingsSetLayout(null) clears a stored snapshot', () => {
  h.invoke('settingsSetLayout', { layout: sampleLayout() });
  h.invoke('settingsSetLayout', { layout: null });
  assert.equal(loadProjectSettings(h.userDataDir, root).layout, undefined);
});

test('settingsSetLayout is a no-op with no project context', () => {
  h.setCtx(undefined);
  h.invoke('settingsSetLayout', { layout: sampleLayout() });
  // Nothing to assert against a project dir; the call simply must not throw.
});

// The `setRegister` channel and its tests were removed in the P5 chrome
// reshape — posture/dials writes returned to the verbs; the chain fields
// remain read-only surfaces (FocusView, helper prompts).

test('focusRead refuses a path that escapes the project', () => {
  assert.deepEqual(h.invoke('focusRead', { path: '../../etc/passwd' }), {
    error: 'path is outside the project',
  });
});

test('focusRead fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('focusRead', { path: 'x.md' }), { error: 'no project context' });
});

test('focusRead parses a focus file in the project into frontmatter + sections', () => {
  const file = join(root, 'demo.focus.md');
  writeFileSync(
    file,
    [
      '---',
      'type: focus',
      'title: Demo',
      'updated: 2026-05-29',
      'references: []',
      'status: Active',
      'focus_type: build',
      '---',
      '',
      '# Demo',
      '',
      '## Gate',
      '',
      'a gate',
      '',
    ].join('\n'),
  );
  const result = h.invoke('focusRead', { path: file }) as {
    error?: string;
    frontmatter?: Record<string, unknown>;
  };
  assert.equal(result.error, undefined);
  assert.equal(result.frontmatter?.type, 'focus');
  assert.equal(result.frontmatter?.title, 'Demo');
});
