import type {
  AppEntry,
  EngineEntry,
  EngineParam,
  IgnoreLevel,
  IgnoreRule,
  SettingDef,
  SettingValue,
} from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CATALOG_ENGINE_IDS,
  type SettingsSnapshot,
  type Shortcut,
  type ShortcutInput,
  type ShortcutTarget,
  type SpaceSpacesFolderResult,
} from '../../../shared/ipc.js';
import { AppPickerModal } from './AppPickerModal.js';
import { ModalSheet } from './overlay/ModalSheet.js';

/** Which tier the Settings sheet is editing. */
type Scope = 'global' | 'project';

const SECTION_FALLBACK = 'General';

/** The rail section that hosts the ignore-rule editor — not a registry section. */
const IGNORE_SECTION = 'Ignore rules';
/** The rail section that hosts the shortcuts manager — not a registry section. */
const SHORTCUTS_SECTION = 'Shortcuts';
/** The rail section that hosts the Apps catalog editor — global-only. */
const APPS_SECTION = 'Apps';
/** The rail section that hosts the AI engines editor — global-only. */
const ENGINES_SECTION = 'Engines';
/** The registry section that hosts the Spaces folder control (M9.10). */
const SPACES_SECTION = 'Spaces';

/** The ignore levels, with their human labels. */
const LEVEL_OPTIONS: { value: IgnoreLevel; label: string }[] = [
  { value: 'no-drift', label: 'No drift' },
  { value: 'no-search', label: 'No search' },
  { value: 'hidden', label: 'Hidden' },
];

function levelLabel(level: IgnoreLevel): string {
  return LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level;
}

/** Whether a setting is editable in the given scope, by its declared tier. */
function inScope(def: SettingDef, scope: Scope): boolean {
  return def.tier === scope || def.tier === 'both';
}

/** The setting's section, or the catch-all when it declares none. */
function sectionOf(def: SettingDef): string {
  return def.section ?? SECTION_FALLBACK;
}

/**
 * The value to show for a setting in a scope: the value stored in that tier if
 * it has one, else what it inherits — the global value, then the default.
 */
function valueForScope(def: SettingDef, snap: SettingsSnapshot, scope: Scope): SettingValue {
  if (scope === 'project' && snap.project && def.key in snap.project.values) {
    return snap.project.values[def.key];
  }
  if (def.key in snap.global.values) return snap.global.values[def.key];
  return def.default;
}

/** Open the Settings sheet at a specific section, or with no section preference. */
export type SettingsSheetSection = 'shortcuts' | 'engines' | 'spaces' | null;

/**
 * The Settings sheet modal — controlled by the parent. `initialSection`
 * pre-selects a rail section.
 */
export function SettingsSheetModal({
  onClose,
  initialSection,
}: {
  onClose: () => void;
  initialSection?: SettingsSheetSection;
}): JSX.Element {
  return <SettingsSheet onClose={onClose} initialSection={initialSection ?? null} />;
}

/**
 * The modal Settings sheet — a section rail, a Global / This-project scope
 * switch, registry-driven controls, and the ignore-rules editor. Hosted in a
 * `ModalSheet` (Radix Dialog), which portals it over the whole window and
 * owns Escape / backdrop dismiss / focus trapping.
 */
function SettingsSheet({
  onClose,
  initialSection,
}: {
  onClose: () => void;
  initialSection: SettingsSheetSection;
}): JSX.Element {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [scope, setScope] = useState<Scope>('global');
  const [section, setSection] = useState<string | null>(
    initialSection === 'shortcuts'
      ? SHORTCUTS_SECTION
      : initialSection === 'engines'
        ? ENGINES_SECTION
        : initialSection === 'spaces'
          ? SPACES_SECTION
          : null,
  );

  useEffect(() => {
    void window.cockpit.settingsGet().then(setSnap);
    const off = window.cockpit.onSettingsChanged(setSnap);
    // Native browser views render above the DOM — hide them under the modal.
    window.cockpit.browserSuppressAll(true);
    return () => {
      off();
      window.cockpit.browserSuppressAll(false);
    };
  }, []);

  // The sections present in the current scope. `Ignore rules` is always there;
  // `Apps` and `Shortcuts` are global-only (the stores are global lists); a
  // registry section shows when it has a setting editable in that tier.
  const sections = useMemo<string[]>(() => {
    if (!snap) return [];
    const set = new Set<string>([IGNORE_SECTION]);
    if (scope === 'global') {
      set.add(APPS_SECTION);
      set.add(ENGINES_SECTION);
      set.add(SHORTCUTS_SECTION);
    }
    for (const def of snap.registry) {
      if (inScope(def, scope)) set.add(sectionOf(def));
    }
    return [...set].sort();
  }, [snap, scope]);

  const activeSection =
    section !== null && sections.includes(section) ? section : (sections[0] ?? null);

  const rows = useMemo<SettingDef[]>(() => {
    if (
      !snap ||
      activeSection === null ||
      activeSection === IGNORE_SECTION ||
      activeSection === SHORTCUTS_SECTION ||
      activeSection === APPS_SECTION ||
      activeSection === ENGINES_SECTION
    ) {
      return [];
    }
    return snap.registry.filter((d) => inScope(d, scope) && sectionOf(d) === activeSection);
  }, [snap, scope, activeSection]);

  const write = useCallback(
    (key: string, value: SettingValue) => {
      void window.cockpit.settingsSet({ tier: scope, key, value }).then(setSnap);
    },
    [scope],
  );

  const writeIgnores = useCallback(
    (rules: IgnoreRule[]) => {
      void window.cockpit.settingsSetIgnores({ tier: scope, rules }).then(setSnap);
    },
    [scope],
  );

  const pickScope = (next: Scope): void => {
    setScope(next);
    setSection(null);
  };

  return (
    <ModalSheet
      label="Settings"
      onClose={onClose}
      testId="settings-sheet"
      backdropStyle={{ background: 'rgba(0, 0, 0, 0.55)' }}
      panelStyle={panelStyle}
    >
      <div style={headerStyle}>
        <span style={titleStyle}>Settings</span>
        <div style={scopeSwitchStyle}>
          <button
            type="button"
            data-testid="settings-scope-global"
            style={scope === 'global' ? scopeTabActiveStyle : scopeTabStyle}
            onClick={() => pickScope('global')}
          >
            Global
          </button>
          <button
            type="button"
            data-testid="settings-scope-project"
            style={scope === 'project' ? scopeTabActiveStyle : scopeTabStyle}
            onClick={() => pickScope('project')}
          >
            This project
          </button>
        </div>
        <button type="button" style={closeStyle} title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div style={bodyStyle}>
        <div style={railStyle}>
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              style={s === activeSection ? railItemActiveStyle : railItemStyle}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={contentStyle}>
          {snap === null ? (
            <div style={hintStyle}>Loading…</div>
          ) : activeSection === IGNORE_SECTION ? (
            <IgnoreRulesSection snapshot={snap} scope={scope} onWrite={writeIgnores} />
          ) : activeSection === APPS_SECTION ? (
            <AppsCatalogSection snapshot={snap} />
          ) : activeSection === ENGINES_SECTION ? (
            <EnginesSection />
          ) : activeSection === SHORTCUTS_SECTION ? (
            <ShortcutsSection />
          ) : rows.length === 0 ? (
            <div style={hintStyle}>
              No {scope === 'project' ? 'project-level' : 'global'} settings yet.
            </div>
          ) : (
            rows.map((def) => (
              <div key={def.key} style={settingRowStyle}>
                <span style={settingLabelStyle}>{def.label}</span>
                {def.key === 'spaces.folder' ? (
                  <SpacesFolderControl value={valueForScope(def, snap, scope)} />
                ) : (
                  <Control
                    def={def}
                    value={valueForScope(def, snap, scope)}
                    onChange={(v) => write(def.key, v)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </ModalSheet>
  );
}

/** The control for one setting, chosen by its declared type. */
function Control({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
}): JSX.Element {
  const testId = `setting-${def.key}`;
  switch (def.type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          data-testid={testId}
          style={checkboxStyle}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          data-testid={testId}
          style={inputStyle}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case 'enum':
      return (
        <select
          data-testid={testId}
          style={inputStyle}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'string':
      return (
        <input
          type="text"
          data-testid={testId}
          style={inputStyle}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * The Spaces folder row (M9.10): the path in monospace, or `Not set`, and
 * `Choose…`, which asks main for the system's folder dialog
 * (`spaceSpacesFolderChoose`) — the renderer never sends a path of its own.
 * The value shown follows `snap` through `onSettingsChanged`, pushed after
 * main saves the choice.
 */
function SpacesFolderControl({ value }: { value: SettingValue }): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const path = typeof value === 'string' && value !== '' ? value : null;

  const choose = async (): Promise<void> => {
    setMessage(null);
    const result: SpaceSpacesFolderResult = await window.cockpit.spaceSpacesFolderChoose({});
    if (!result.ok && result.error.kind !== 'cancelled') setMessage(result.error.message);
  };

  return (
    <div style={spacesFolderStyle}>
      <span style={path !== null ? spacesFolderPathStyle : spacesFolderNotSetStyle}>
        {path ?? 'Not set'}
      </span>
      <button
        type="button"
        style={chooseAppStyle}
        data-testid="setting-spaces.folder-choose"
        onClick={() => void choose()}
      >
        Choose…
      </button>
      {message !== null ? <span style={spacesFolderErrorStyle}>{message}</span> : null}
    </div>
  );
}

/**
 * The Ignore rules section: the tier's own rules, editable (level + remove),
 * with the inherited rules shown read-only above them, and a row to add one.
 */
function IgnoreRulesSection({
  snapshot,
  scope,
  onWrite,
}: {
  snapshot: SettingsSnapshot;
  scope: Scope;
  onWrite: (rules: IgnoreRule[]) => void;
}): JSX.Element {
  const [draftPattern, setDraftPattern] = useState('');
  const [draftLevel, setDraftLevel] = useState<IgnoreLevel>('no-drift');

  const editable: readonly IgnoreRule[] =
    scope === 'global' ? snapshot.global.ignores : (snapshot.project?.ignores ?? []);
  const inherited: IgnoreRule[] =
    scope === 'global'
      ? [...snapshot.defaultIgnores]
      : [...snapshot.defaultIgnores, ...snapshot.global.ignores];

  const setLevel = (index: number, level: IgnoreLevel): void => {
    onWrite(editable.map((r, i) => (i === index ? { ...r, level } : r)));
  };
  const remove = (index: number): void => {
    onWrite(editable.filter((_, i) => i !== index));
  };
  const add = (): void => {
    const pattern = draftPattern.trim();
    setDraftPattern('');
    setDraftLevel('no-drift');
    if (pattern === '' || editable.some((r) => r.pattern === pattern)) return;
    onWrite([...editable, { pattern, level: draftLevel }]);
  };

  return (
    <>
      <p style={ignoreBlurbStyle}>
        Patterns matched here drop out of the cockpit by level — <strong>No drift</strong> silences
        the watcher, <strong>No search</strong> also hides them from search, <strong>Hidden</strong>{' '}
        also removes them from the file tree.
        {scope === 'project' ? ' Project rules add to and override the global ones.' : ''}
      </p>

      {inherited.length > 0 ? (
        <div style={ignoreGroupStyle}>
          <span style={ignoreGroupLabelStyle}>Inherited</span>
          {inherited.map((rule) => (
            <div key={`inh:${rule.pattern}`} style={ignoreRowStyle}>
              <span style={ignorePatternStyle}>{rule.pattern}</span>
              <span style={ignoreInheritedLevelStyle}>{levelLabel(rule.level)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={ignoreGroupStyle}>
        <span style={ignoreGroupLabelStyle}>{scope === 'global' ? 'Global' : 'This project'}</span>
        {editable.length === 0 ? (
          <div style={hintStyle}>No rules yet.</div>
        ) : (
          editable.map((rule, index) => (
            <div key={`own:${rule.pattern}`} style={ignoreRowStyle} data-testid="ignore-rule">
              <span style={ignorePatternStyle}>{rule.pattern}</span>
              <select
                style={ignoreLevelSelectStyle}
                value={rule.level}
                onChange={(e) => setLevel(index, e.target.value as IgnoreLevel)}
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                style={ignoreRemoveStyle}
                title="Remove rule"
                onClick={() => remove(index)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div style={ignoreAddRowStyle}>
        <input
          type="text"
          style={ignoreAddInputStyle}
          placeholder="folder name, or *.glob"
          value={draftPattern}
          spellCheck={false}
          data-testid="ignore-add-pattern"
          onChange={(e) => setDraftPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <select
          style={ignoreLevelSelectStyle}
          value={draftLevel}
          onChange={(e) => setDraftLevel(e.target.value as IgnoreLevel)}
        >
          {LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" style={ignoreAddBtnStyle} data-testid="ignore-add" onClick={add}>
          Add
        </button>
      </div>
    </>
  );
}

/** App name from a `/Applications/Foo.app` path. */
function appName(appPath: string): string {
  return (appPath.split('/').pop() ?? appPath).replace(/\.app$/i, '');
}

type ShortcutDraft = {
  target: ShortcutTarget;
  app: string;
  url: string;
  command: string;
  labelInput: string;
};

const SHORTCUT_TARGETS: { id: ShortcutTarget; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'lore', label: 'Lore' },
  { id: 'url', label: 'URL' },
  { id: 'terminal', label: 'Terminal' },
];

function defaultShortcutLabel(draft: ShortcutDraft): string {
  if (draft.target === 'url') return draft.url.trim() || 'URL shortcut';
  if (draft.target === 'terminal') return draft.command.trim() || 'Terminal shortcut';
  const where = draft.target === 'lore' ? 'Lore' : 'project';
  return draft.app ? `Open ${where} in ${appName(draft.app)}` : `Open ${where}`;
}

/**
 * Manage the legacy shortcuts list — currently scoped to URL and terminal
 * shortcuts that surface in each panel's tab strip. Folder shortcuts
 * (Project / Lore) were migrated into the Apps catalog in v0.6 Phase A and
 * no longer surface here.
 */
function ShortcutsSection(): JSX.Element {
  const [list, setList] = useState<Shortcut[]>([]);
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);

  useEffect(() => {
    void window.cockpit.shortcutsList().then(setList);
    return window.cockpit.onShortcutsChanged(setList);
  }, []);

  const pickApp = useCallback(async () => {
    const app = await window.cockpit.shortcutsPickApp();
    if (app) setDraft((d) => (d ? { ...d, app } : d));
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const label = draft.labelInput.trim() || defaultShortcutLabel(draft);
    let input: ShortcutInput;
    if (draft.target === 'url') input = { label, target: 'url', url: draft.url.trim() };
    else if (draft.target === 'terminal')
      input = { label, target: 'terminal', command: draft.command.trim() };
    else input = { label, target: draft.target, app: draft.app };
    void window.cockpit.shortcutsAdd(input).then(setList);
    setDraft(null);
  }, [draft]);

  const canSave = draft
    ? draft.target === 'url'
      ? draft.url.trim() !== ''
      : draft.target === 'terminal'
        ? draft.command.trim() !== ''
        : draft.app !== ''
    : false;

  return (
    <>
      <p style={ignoreBlurbStyle}>
        Shortcuts launch a folder in an app (Finder, an editor) or a URL in Chrome. They appear in
        the header for quick access.
      </p>

      <div style={ignoreGroupStyle}>
        <span style={ignoreGroupLabelStyle}>Configured</span>
        {list.length === 0 ? (
          <div style={hintStyle}>No shortcuts yet.</div>
        ) : (
          list.map((s) => (
            <div key={s.id} style={ignoreRowStyle} data-testid="shortcut-row">
              <span style={ignorePatternStyle}>{s.label}</span>
              <button
                type="button"
                style={ignoreRemoveStyle}
                title="Remove shortcut"
                onClick={() => void window.cockpit.shortcutsRemove(s.id).then(setList)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {draft ? (
        <div style={formStyle}>
          <div style={{ display: 'flex', gap: '0.7rem' }}>
            {SHORTCUT_TARGETS.map((t) => (
              <label key={t.id} style={radioLabelStyle}>
                <input
                  type="radio"
                  checked={draft.target === t.id}
                  onChange={() => setDraft({ ...draft, target: t.id })}
                />
                {t.label}
              </label>
            ))}
          </div>
          {draft.target === 'url' ? (
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>URL</span>
              <input
                style={textInputStyle}
                value={draft.url}
                placeholder="https://example.com"
                spellCheck={false}
                data-testid="shortcut-url"
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </label>
          ) : draft.target === 'terminal' ? (
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Command</span>
              <input
                style={textInputStyle}
                value={draft.command}
                placeholder="e.g. npm run dev"
                spellCheck={false}
                data-testid="shortcut-command"
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
            </label>
          ) : (
            <div style={fieldStyle}>
              <span style={fieldLabelStyle}>Application</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button type="button" style={chooseAppStyle} onClick={() => void pickApp()}>
                  Choose app…
                </button>
                {draft.app ? <span style={appNameStyle}>{appName(draft.app)}</span> : null}
              </div>
            </div>
          )}
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Name</span>
            <input
              style={textInputStyle}
              value={draft.labelInput}
              placeholder={defaultShortcutLabel(draft)}
              onChange={(e) => setDraft({ ...draft, labelInput: e.target.value })}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              type="button"
              style={canSave ? saveBtnStyle : saveDisabledStyle}
              disabled={!canSave}
              data-testid="shortcut-save"
              onClick={saveDraft}
            >
              Save
            </button>
            <button type="button" style={cancelBtnStyle} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={shortcutAddBtnStyle}
          data-testid="shortcut-add"
          onClick={() =>
            setDraft({ target: 'project', app: '', url: '', command: '', labelInput: '' })
          }
        >
          + Add shortcut
        </button>
      )}
    </>
  );
}

const panelStyle: React.CSSProperties = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '660px',
  maxWidth: '90vw',
  height: '460px',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-raised)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '8px',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
  overflow: 'hidden',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  padding: '0.7rem 0.9rem',
  borderBottom: '1px solid var(--color-border)',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '0.92rem',
  color: 'var(--color-text-bright)',
};

const scopeSwitchStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.2rem',
  marginLeft: 'auto',
  padding: '0.15rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
};

const scopeTabStyle: React.CSSProperties = {
  padding: '0.25rem 0.6rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const scopeTabActiveStyle: React.CSSProperties = {
  ...scopeTabStyle,
  background: 'var(--color-accent-strong)',
  color: 'var(--color-on-accent)',
};

const closeStyle: React.CSSProperties = {
  width: '1.7rem',
  height: '1.7rem',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const railStyle: React.CSSProperties = {
  width: '170px',
  flexShrink: 0,
  padding: '0.5rem',
  borderRight: '1px solid var(--color-border)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
};

const railItemStyle: React.CSSProperties = {
  padding: '0.4rem 0.55rem',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text-2)',
  fontSize: '0.78rem',
  cursor: 'pointer',
};

const railItemActiveStyle: React.CSSProperties = {
  ...railItemStyle,
  background: 'var(--color-border)',
  color: 'var(--color-text-bright)',
  fontWeight: 600,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '0.9rem 1rem',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const hintStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.8rem',
};

const settingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.5rem 0.6rem',
  background: 'var(--color-header)',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
};

const settingLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text)',
};

const checkboxStyle: React.CSSProperties = {
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.45rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-bright)',
  fontSize: '0.78rem',
};

const ignoreBlurbStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-secondary)',
  fontSize: '0.76rem',
  lineHeight: 1.5,
};

const ignoreGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const ignoreGroupLabelStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-dim)',
};

const ignoreRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.3rem 0.5rem',
  background: 'var(--color-header)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
};

const ignorePatternStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.76rem',
  color: 'var(--color-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const ignoreInheritedLevelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
};

const ignoreLevelSelectStyle: React.CSSProperties = {
  ...inputStyle,
  fontSize: '0.74rem',
};

const ignoreRemoveStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '1.4rem',
  height: '1.4rem',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const ignoreAddRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  paddingTop: '0.2rem',
};

const ignoreAddInputStyle: React.CSSProperties = {
  ...inputStyle,
  flex: 1,
  minWidth: 0,
};

const ignoreAddBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.3rem 0.8rem',
  background: 'var(--color-accent-strong)',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-on-accent)',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '0.4rem 0.5rem',
  background: 'var(--color-header)',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
};

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  color: 'var(--color-text-2)',
  fontSize: '0.76rem',
  cursor: 'pointer',
};

const textInputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-bright)',
  fontSize: '0.76rem',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-dim)',
};

const chooseAppStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  background: 'var(--color-surface-blue)',
  border: '1px solid var(--color-surface-blue-border)',
  borderRadius: '4px',
  color: 'var(--color-text-2)',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const appNameStyle: React.CSSProperties = {
  color: 'var(--color-text-bright)',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const saveBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  background: 'var(--color-accent-strong)',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-on-accent)',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const saveDisabledStyle: React.CSSProperties = {
  ...saveBtnStyle,
  background: 'var(--color-chip-disabled)',
  color: 'var(--color-text-soft)',
  cursor: 'default',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  background: 'var(--color-chip-disabled)',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text-2)',
  fontSize: '0.76rem',
  cursor: 'pointer',
};

const shortcutAddBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: '1px dashed var(--color-accent-strong)',
  borderRadius: '4px',
  color: 'var(--color-accent)',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
};

/**
 * The Apps catalog editor. Each entry is one row with its label, kind / target
 * summary, and a remove button. "Add app" opens the [`AppPickerModal`](./AppPickerModal.tsx),
 * the same modal the first-use flow uses from context menus.
 */
function AppsCatalogSection({ snapshot }: { snapshot: SettingsSnapshot }): JSX.Element {
  const apps = snapshot.global.apps ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);

  const persist = (next: AppEntry[]): void => {
    void window.cockpit.appsSave(next);
  };

  const removeApp = (id: string): void => {
    persist(apps.filter((a) => a.id !== id));
  };

  return (
    <div style={appsCatalogStyle} data-testid="settings-apps-section">
      <div style={appsHintStyle}>
        Apps appear in every file and folder context menu as "Open with…" entries. The "diff" role
        marks the entry the *Diff against latest save-point* action uses.
      </div>
      {apps.length === 0 ? (
        <div style={appsEmptyStyle}>No apps configured yet.</div>
      ) : (
        <ul style={appsListStyle}>
          {apps.map((app) => (
            <li key={app.id} style={appRowStyle}>
              {app.iconUrl ? (
                <img src={app.iconUrl} alt="" width={20} height={20} style={appIconStyle} />
              ) : (
                <span style={appIconPlaceholder}>{app.kind === 'cli' ? '⌘' : '▸'}</span>
              )}
              <div style={appLabelColumnStyle}>
                <span style={appLabelStyle}>{app.label}</span>
                <span style={appMetaStyle}>{appMetaSummary(app)}</span>
              </div>
              <button
                type="button"
                style={appRemoveStyle}
                onClick={() => removeApp(app.id)}
                data-testid={`app-remove-${app.id}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        style={shortcutAddBtnStyle}
        onClick={() => setPickerOpen(true)}
        data-testid="apps-add"
      >
        Add app
      </button>
      {pickerOpen ? (
        <AppPickerModal
          initial="open-with"
          onSave={(entry) => {
            persist([...apps, entry]);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function appMetaSummary(app: AppEntry): string {
  const target =
    app.target === 'both' ? 'file + folder' : app.target === 'file' ? 'file' : 'folder';
  if (app.kind === 'app') return `${target} · ${app.appPath ?? ''}`;
  const argv = app.argvTemplate ?? '';
  const role = app.role === 'diff' ? ' · diff role' : '';
  return `${target} · ${app.cliPath ?? ''} ${argv}${role}`;
}

const appsCatalogStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const appsHintStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.45,
};

const appsEmptyStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--color-text-soft)',
  fontStyle: 'italic',
};

const appsListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const appRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.45rem 0.6rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
};

const appIconStyle: React.CSSProperties = {
  borderRadius: '4px',
};

const appIconPlaceholder: React.CSSProperties = {
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-border)',
  borderRadius: '4px',
  fontSize: '0.78rem',
};

const appLabelColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
  flex: 1,
  minWidth: 0,
};

const appLabelStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--color-text)',
  fontWeight: 600,
};

const appMetaStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-soft)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const appRemoveStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  padding: '0.2rem 0.55rem',
  cursor: 'pointer',
};

/**
 * The AI engines editor. Each row shows the engine's display name, binary,
 * and (optional) args. "Add engine" appends a draft row the user fills in.
 * Defaults (`Claude` / `Gemini`) are back-filled by main when their binary
 * resolves on PATH; removing them records the id so the seed does not
 * respawn on next launch.
 */
function EnginesSection(): JSX.Element {
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [draft, setDraft] = useState<EngineEntry | null>(null);

  useEffect(() => {
    void window.cockpit.enginesList().then(setEngines);
    return window.cockpit.onEnginesChanged(setEngines);
  }, []);

  const persist = (next: EngineEntry[]): void => {
    void window.cockpit.enginesSave(next).then(setEngines);
  };

  const removeEngine = (id: string): void => {
    persist(engines.filter((e) => e.id !== id));
  };

  const startDraft = (): void => {
    setDraft({ id: crypto.randomUUID(), name: '', binary: '', params: [] });
  };

  const commitDraft = (): void => {
    if (!draft || !draft.name.trim() || !draft.binary.trim()) return;
    const entry: EngineEntry = {
      id: draft.id,
      name: draft.name.trim(),
      binary: draft.binary.trim(),
      params: (draft.params ?? []).filter((param) => param.text.trim().length > 0),
    };
    if (draft.model !== undefined) entry.model = draft.model;

    const index = engines.findIndex((e) => e.id === entry.id);
    if (index >= 0) {
      const next = [...engines];
      next[index] = entry;
      persist(next);
    } else {
      persist([...engines, entry]);
    }
    setDraft(null);
  };

  return (
    <div style={appsCatalogStyle} data-testid="settings-engines-section">
      <div style={appsHintStyle}>
        AI engines appear in every panel&apos;s <strong>+ AI ▾</strong> opener. Each entry is a
        binary the cockpit spawns in the tab&apos;s shell — bare names resolve on your login PATH.
        Defaults are seeded automatically when <code>claude</code> or <code>gemini</code>
        are on PATH.
      </div>
      {draft ? (
        <div style={engineDraftStyle} data-testid="engine-draft">
          <input
            style={engineInputStyle}
            placeholder="Display name (e.g. Claude)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            data-testid="engine-draft-name"
          />
          <input
            style={engineInputStyle}
            placeholder="Binary (e.g. claude, /usr/local/bin/claude)"
            value={draft.binary}
            onChange={(e) => setDraft({ ...draft, binary: e.target.value })}
            data-testid="engine-draft-binary"
          />
          <input
            style={engineInputStyle}
            placeholder="the engine's default"
            value={draft.model ?? ''}
            onChange={(e) => {
              const model = e.target.value;
              const next: EngineEntry = { ...draft };
              if (model.trim().length > 0) next.model = model;
              else delete next.model;
              setDraft(next);
            }}
            data-testid="engine-draft-model"
          />
          <div style={engineParamsListStyle} data-testid="engine-draft-params">
            {(draft.params ?? []).map((param, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list has no other stable key while being edited.
              <div key={index} style={engineParamRowStyle}>
                <input
                  style={engineInputStyle}
                  placeholder="Parameter (e.g. --dangerously-skip-permissions)"
                  value={param.text}
                  onChange={(e) => {
                    const params = [...(draft.params ?? [])];
                    params[index] = { ...param, text: e.target.value };
                    setDraft({ ...draft, params });
                  }}
                  data-testid={`engine-draft-param-${index}`}
                />
                <label style={engineParamDefaultLabelStyle}>
                  <input
                    type="checkbox"
                    checked={param.defaultOn}
                    onChange={(e) => {
                      const params = [...(draft.params ?? [])];
                      params[index] = { ...param, defaultOn: e.target.checked };
                      setDraft({ ...draft, params });
                    }}
                    data-testid={`engine-draft-param-default-${index}`}
                  />
                  Ticked by default
                </label>
                <button
                  type="button"
                  style={appRemoveStyle}
                  onClick={() => {
                    const params = (draft.params ?? []).filter((_, i) => i !== index);
                    setDraft({ ...draft, params });
                  }}
                  data-testid={`engine-draft-param-remove-${index}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            style={appRemoveStyle}
            onClick={() => {
              const param: EngineParam = { text: '', defaultOn: false };
              setDraft({ ...draft, params: [...(draft.params ?? []), param] });
            }}
            data-testid="engine-draft-param-add"
          >
            Add parameter
          </button>
          <div style={engineDraftButtonRow}>
            <button
              type="button"
              style={shortcutAddBtnStyle}
              onClick={commitDraft}
              data-testid="engine-draft-save"
              disabled={!draft.name.trim() || !draft.binary.trim()}
            >
              Save engine
            </button>
            <button
              type="button"
              style={appRemoveStyle}
              onClick={() => setDraft(null)}
              data-testid="engine-draft-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {engines.length === 0 ? (
            <div style={appsEmptyStyle}>No engines configured yet.</div>
          ) : (
            <ul style={appsListStyle}>
              {engines.map((engine) => {
                const isCatalog = (CATALOG_ENGINE_IDS as readonly string[]).includes(engine.id);
                return (
                  <li key={engine.id} style={appRowStyle} data-testid={`engine-row-${engine.id}`}>
                    <span style={appIconPlaceholder}>✦</span>
                    <div style={appLabelColumnStyle}>
                      <span style={appLabelStyle}>{engine.name}</span>
                      <span style={appMetaStyle}>{engineMetaSummary(engine)}</span>
                      {isCatalog ? (
                        <span style={catalogEngineNoteStyle}>
                          Listed by AI-Lore; it cannot be removed. Its parameters can be edited.
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        type="button"
                        style={appRemoveStyle}
                        onClick={() => setDraft(engine)}
                        data-testid={`engine-edit-${engine.id}`}
                      >
                        Edit
                      </button>
                      {isCatalog ? null : (
                        <button
                          type="button"
                          style={appRemoveStyle}
                          onClick={() => removeEngine(engine.id)}
                          data-testid={`engine-remove-${engine.id}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            style={shortcutAddBtnStyle}
            onClick={startDraft}
            data-testid="engine-add"
          >
            Add engine
          </button>
        </>
      )}
    </div>
  );
}

function engineMetaSummary(engine: EngineEntry): string {
  const params = (engine.params ?? [])
    .map((param) => (param.defaultOn ? `${param.text} (default)` : param.text))
    .join(' ');
  return params.length > 0 ? `${engine.binary} ${params}` : engine.binary;
}

const engineDraftStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '0.55rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-2)',
  borderRadius: '5px',
};

const engineInputStyle: React.CSSProperties = {
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.82rem',
  padding: '0.35rem 0.55rem',
};

const engineDraftButtonRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  alignItems: 'center',
};

const engineParamsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const engineParamRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  alignItems: 'center',
};

const engineParamDefaultLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
};

const spacesFolderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const spacesFolderPathStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.78rem',
  color: 'var(--color-text-bright)',
  wordBreak: 'break-all',
};

const spacesFolderNotSetStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--color-text-soft)',
  fontStyle: 'italic',
};

const spacesFolderErrorStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: 'var(--color-warn-fg)',
};

/** M9.10: "Listed by AI-Lore; it cannot be removed." under a catalog engine row. */
const catalogEngineNoteStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-soft)',
};
