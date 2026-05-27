import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type AppEntry,
  SETTINGS_REGISTRY,
  SETTINGS_SCHEMA_VERSION,
  type SettingDef,
  type SettingsFile,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  type WorkspaceLayout,
  emptySettingsFile,
  isValidValue,
  parseSettingsFile,
  resolveAll,
  resolveSetting,
  serializeSettingsFile,
  validateRegistry,
  withApps,
  withIgnores,
  withLayout,
  withSetting,
} from '../src/index.js';

// Synthetic registry entries — Phase A ships the mechanism with no real
// settings, so the tests exercise resolution against their own definitions.
const toggle: SettingDef = {
  key: 'a.toggle',
  label: 'A toggle',
  type: 'boolean',
  tier: 'both',
  default: false,
};
const name: SettingDef = {
  key: 'a.name',
  label: 'A name',
  type: 'string',
  tier: 'global',
  default: 'anon',
};
const size: SettingDef = {
  key: 'a.size',
  label: 'A size',
  type: 'number',
  tier: 'project',
  default: 10,
};
const mode: SettingDef = {
  key: 'a.mode',
  label: 'A mode',
  type: 'enum',
  tier: 'both',
  default: 'light',
  options: ['light', 'dark'],
};

const file = (values: SettingsFile['values']): SettingsFile => ({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  values,
  ignores: [],
});

test('emptySettingsFile is at the current schema version with no values', () => {
  assert.deepEqual(emptySettingsFile(), {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    values: {},
    ignores: [],
  });
  assert.equal(SETTINGS_SCHEMA_VERSION, 1);
});

test('resolveSetting falls back to the registry default when no tier carries a value', () => {
  assert.equal(resolveSetting(toggle, emptySettingsFile(), emptySettingsFile()), false);
  assert.equal(resolveSetting(name, emptySettingsFile(), null), 'anon');
});

test('resolveSetting takes the global value over the default', () => {
  assert.equal(resolveSetting(name, file({ 'a.name': 'lead' }), null), 'lead');
});

test('resolveSetting takes the per-project value over the global value', () => {
  assert.equal(
    resolveSetting(toggle, file({ 'a.toggle': false }), file({ 'a.toggle': true })),
    true,
  );
});

test('a global-tier setting ignores a value found in the project file', () => {
  assert.equal(
    resolveSetting(name, file({ 'a.name': 'global' }), file({ 'a.name': 'project' })),
    'global',
  );
});

test('a project-tier setting ignores a value found in the global file', () => {
  assert.equal(resolveSetting(size, file({ 'a.size': 99 }), file({ 'a.size': 42 })), 42);
  assert.equal(resolveSetting(size, file({ 'a.size': 99 }), null), 10);
});

test('resolveSetting skips a stored value that fails the declared type', () => {
  assert.equal(
    resolveSetting(toggle, file({ 'a.toggle': 'yes' as unknown as boolean }), null),
    false,
  );
  assert.equal(resolveSetting(mode, file({ 'a.mode': 'sepia' }), null), 'light');
});

test('resolveAll resolves every registry entry into a flat map', () => {
  const resolved = resolveAll(
    [toggle, name, size],
    file({ 'a.name': 'lead' }),
    file({ 'a.size': 7 }),
  );
  assert.deepEqual(resolved, { 'a.toggle': false, 'a.name': 'lead', 'a.size': 7 });
});

test('isValidValue enforces each declared type', () => {
  assert.equal(isValidValue(toggle, true), true);
  assert.equal(isValidValue(toggle, 'true'), false);
  assert.equal(isValidValue(name, 'x'), true);
  assert.equal(isValidValue(name, 3), false);
  assert.equal(isValidValue(size, 3), true);
  assert.equal(isValidValue(size, Number.NaN), false);
  assert.equal(isValidValue(mode, 'dark'), true);
  assert.equal(isValidValue(mode, 'sepia'), false);
});

test('withSetting returns a new file and does not mutate the input', () => {
  const before = file({ 'a.name': 'one' });
  const after = withSetting(before, 'a.name', 'two');
  assert.equal(after.values['a.name'], 'two');
  assert.equal(before.values['a.name'], 'one');
});

test('parseSettingsFile reads a valid file and tolerates missing/corrupt input', () => {
  assert.deepEqual(parseSettingsFile('{"schemaVersion":1,"values":{"a.name":"x"}}'), {
    schemaVersion: 1,
    values: { 'a.name': 'x' },
    ignores: [],
  });
  assert.deepEqual(parseSettingsFile(null), emptySettingsFile());
  assert.deepEqual(parseSettingsFile('not json'), emptySettingsFile());
  assert.deepEqual(parseSettingsFile('[]'), emptySettingsFile());
});

test('parseSettingsFile drops non-primitive stored values', () => {
  const parsed = parseSettingsFile('{"values":{"a.ok":1,"a.bad":{"nested":true}}}');
  assert.deepEqual(parsed.values, { 'a.ok': 1 });
});

test('serializeSettingsFile round-trips through parseSettingsFile', () => {
  const original = withSetting(emptySettingsFile(), 'a.toggle', true);
  assert.deepEqual(parseSettingsFile(serializeSettingsFile(original)), original);
});

test('validateRegistry flags duplicate keys, optionless enums, and bad defaults', () => {
  assert.deepEqual(validateRegistry([toggle, name, size, mode]), []);
  const errors = validateRegistry([
    toggle,
    toggle,
    { key: 'x.enum', label: 'X', type: 'enum', tier: 'global', default: 'a' },
    {
      key: 'x.num',
      label: 'X',
      type: 'number',
      tier: 'global',
      default: 'nope' as unknown as number,
    },
  ]);
  assert.ok(errors.some((e) => e.includes('duplicate key: a.toggle')));
  assert.ok(errors.some((e) => e.includes('enum setting has no options: x.enum')));
  assert.ok(errors.some((e) => e.includes('default is not a valid number: x.num')));
});

test('the shipped SETTINGS_REGISTRY is a sound registry', () => {
  assert.deepEqual(validateRegistry(SETTINGS_REGISTRY), []);
});

test('SETTINGS_REGISTRY carries the header-accent appearance setting', () => {
  const accent = SETTINGS_REGISTRY.find((d) => d.key === 'appearance.showProjectAccent');
  assert.ok(accent, 'expected the appearance.showProjectAccent setting');
  assert.equal(accent?.type, 'boolean');
  assert.equal(accent?.tier, 'both');
  assert.equal(accent?.default, true);
});

test('parseSettingsFile reads ignore rules and drops malformed ones', () => {
  const parsed = parseSettingsFile(
    '{"values":{},"ignores":[{"pattern":"dist","level":"hidden"},{"pattern":"x"},"bad"]}',
  );
  assert.deepEqual(parsed.ignores, [{ pattern: 'dist', level: 'hidden' }]);
});

test('withIgnores replaces the ignore set without mutating the input', () => {
  const before = emptySettingsFile();
  const after = withIgnores(before, [{ pattern: 'dist', level: 'no-drift' }]);
  assert.deepEqual(after.ignores, [{ pattern: 'dist', level: 'no-drift' }]);
  assert.deepEqual(before.ignores, []);
});

test('withSetting preserves the file ignore rules', () => {
  const before = withIgnores(emptySettingsFile(), [{ pattern: 'dist', level: 'hidden' }]);
  const after = withSetting(before, 'a.name', 'x');
  assert.deepEqual(after.ignores, [{ pattern: 'dist', level: 'hidden' }]);
});

const sampleLayout = (): WorkspaceLayout => ({
  schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
  panels: {
    left: {
      tabs: [{ id: 'status', kind: 'pane', title: 'Status' }],
      activeId: 'status',
    },
    right: { tabs: [], activeId: '' },
    bottom: {
      tabs: [{ id: 'tab-1', kind: 'browser', title: 'Browser 1', baseTitle: 'Browser 1' }],
      activeId: 'tab-1',
    },
  },
  rightOpen: false,
  bottomOpen: true,
  rightWidth: 480,
  bottomHeight: 300,
  browserUrls: { 'tab-1': 'https://example.com/' },
});

test('SETTINGS_REGISTRY carries the workspace.restoreLayout toggle', () => {
  const def = SETTINGS_REGISTRY.find((d) => d.key === 'workspace.restoreLayout');
  assert.ok(def, 'expected the workspace.restoreLayout setting');
  assert.equal(def?.type, 'boolean');
  assert.equal(def?.tier, 'global');
  assert.equal(def?.default, true);
});

test('withLayout attaches a snapshot without mutating the input', () => {
  const before = emptySettingsFile();
  const after = withLayout(before, sampleLayout());
  assert.equal(before.layout, undefined);
  assert.equal(after.layout?.bottomHeight, 300);
});

test('withLayout(null) clears an existing snapshot', () => {
  const before = withLayout(emptySettingsFile(), sampleLayout());
  const after = withLayout(before, null);
  assert.equal(after.layout, undefined);
});

test('withSetting and withIgnores preserve an attached layout', () => {
  const base = withLayout(emptySettingsFile(), sampleLayout());
  assert.equal(withSetting(base, 'a.toggle', true).layout?.rightWidth, 480);
  assert.equal(withIgnores(base, [{ pattern: 'dist', level: 'hidden' }]).layout?.rightWidth, 480);
});

test('parseSettingsFile round-trips a layout through serialize', () => {
  const original = withLayout(emptySettingsFile(), sampleLayout());
  const parsed = parseSettingsFile(serializeSettingsFile(original));
  assert.deepEqual(parsed.layout, original.layout);
});

const sampleApp: AppEntry = {
  id: 'vscode',
  label: 'VS Code',
  kind: 'app',
  target: 'both',
  appPath: '/Applications/Visual Studio Code.app',
};

test('withApps attaches the catalog without mutating the input', () => {
  const before = emptySettingsFile();
  const after = withApps(before, [sampleApp]);
  assert.equal(before.apps, undefined);
  assert.equal(after.apps?.length, 1);
  assert.equal(after.apps?.[0]?.id, 'vscode');
});

test('withApps replacing the catalog preserves layout + ignores', () => {
  const base = withIgnores(
    withLayout(emptySettingsFile(), sampleLayout()),
    [{ pattern: 'dist', level: 'hidden' }],
  );
  const after = withApps(base, [sampleApp]);
  assert.equal(after.apps?.length, 1);
  assert.equal(after.layout?.rightWidth, 480);
  assert.equal(after.ignores.length, 1);
});

test('parseSettingsFile round-trips Apps through serialize', () => {
  const original = withApps(emptySettingsFile(), [sampleApp]);
  const parsed = parseSettingsFile(serializeSettingsFile(original));
  assert.equal(parsed.apps?.length, 1);
  assert.equal(parsed.apps?.[0]?.label, 'VS Code');
});

test('parseSettingsFile drops a layout at an unknown version', () => {
  const text = JSON.stringify({
    schemaVersion: 1,
    values: {},
    ignores: [],
    layout: { ...sampleLayout(), schemaVersion: 999 },
  });
  assert.equal(parseSettingsFile(text).layout, undefined);
});

test('parseSettingsFile drops a layout with a missing panel', () => {
  const broken = sampleLayout() as unknown as Record<string, unknown>;
  (broken.panels as Record<string, unknown>).right = undefined;
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout: broken });
  assert.equal(parseSettingsFile(text).layout, undefined);
});

test('parseSettingsFile drops malformed tabs but keeps the good ones', () => {
  const layout: WorkspaceLayout = sampleLayout();
  // biome-ignore lint/suspicious/noExplicitAny: stuffing a malformed entry on purpose.
  (layout.panels.left.tabs as any).push({ id: 42, kind: 'pane', title: 'bad' });
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout });
  const parsed = parseSettingsFile(text);
  const got = parsed.layout;
  if (!got) throw new Error('expected a layout');
  assert.equal(got.panels.left.tabs.length, 1);
  const first = got.panels.left.tabs[0];
  assert.equal(first?.id, 'status');
});

test('parseSettingsFile drops non-string browserUrls entries', () => {
  const layout: WorkspaceLayout = sampleLayout();
  (layout.browserUrls as Record<string, unknown>)['tab-bad'] = 42 as unknown as string;
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout });
  const parsed = parseSettingsFile(text);
  assert.deepEqual(parsed.layout?.browserUrls, { 'tab-1': 'https://example.com/' });
});

test('parseSettingsFile keeps the engine field on an ai-kind tab', () => {
  const layout: WorkspaceLayout = sampleLayout();
  layout.panels.right.tabs.push({
    id: 'tab-ai-1',
    kind: 'ai',
    title: 'AI 1',
    baseTitle: 'AI 1',
    engine: 'claude',
  });
  layout.panels.right.activeId = 'tab-ai-1';
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout });
  const parsed = parseSettingsFile(text);
  const aiTab = parsed.layout?.panels.right.tabs.find((t) => t.id === 'tab-ai-1');
  assert.equal(aiTab?.kind, 'ai');
  assert.equal(aiTab?.engine, 'claude');
});

test('parseSettingsFile drops a tab with a non-string engine field', () => {
  const layout: WorkspaceLayout = sampleLayout();
  // biome-ignore lint/suspicious/noExplicitAny: stuffing a malformed entry on purpose.
  (layout.panels.right.tabs as any).push({
    id: 'tab-ai-bad',
    kind: 'ai',
    title: 'AI bad',
    engine: 42,
  });
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout });
  const parsed = parseSettingsFile(text);
  assert.equal(
    parsed.layout?.panels.right.tabs.find((t) => t.id === 'tab-ai-bad'),
    undefined,
  );
});

test('parseSettingsFile preserves a pre-v0.7 tab kind so the renderer can migrate it', () => {
  // Pre-v0.7 layouts persisted shell tabs as `kind: 'terminal'`. The core parser
  // keeps that string as-is; the renderer's `tabFromLayout` lifts it to `'shell'`.
  const layout: WorkspaceLayout = sampleLayout();
  layout.panels.right.tabs.push({ id: 'tab-old', kind: 'terminal', title: 'Terminal 1' });
  const text = JSON.stringify({ schemaVersion: 1, values: {}, ignores: [], layout });
  const parsed = parseSettingsFile(text);
  assert.equal(
    parsed.layout?.panels.right.tabs.find((t) => t.id === 'tab-old')?.kind,
    'terminal',
  );
});

