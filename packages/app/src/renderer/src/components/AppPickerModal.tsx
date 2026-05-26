import type { AppEntry } from '@ai-lore-companion/core';
import { type JSX, useState } from 'react';

/**
 * Modal for adding a new entry to the Apps catalog. Reusable across two
 * entry points:
 *
 *   1. **First-use from a context menu** — clicking *Diff against latest
 *      save-point* with no diff entry, or *Open with…* on an empty catalog,
 *      surfaces this modal so the user can pick an app without visiting
 *      Settings.
 *   2. **Settings → Apps "Add app"** — same modal, no preselect.
 *
 * Prefilled suggestions live in `PRESETS`. A *Custom* form lets the user
 * enter arbitrary `kind: 'app' | 'cli'` entries.
 *
 * Phase A: [actions-in-context](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/A-actions-in-context.phase.md).
 */

export type AppPickerPreselect = 'diff' | 'open-with' | 'custom';

type Props = {
  /** Optional preselect — drives which preset list is shown first. */
  initial?: AppPickerPreselect;
  /** Called with the new entry after the user confirms. */
  onSave: (entry: AppEntry) => void;
  onClose: () => void;
};

type Preset = {
  label: string;
  kind: AppEntry['kind'];
  target: AppEntry['target'];
  role?: AppEntry['role'];
  appPath?: string;
  cliPath?: string;
  argvTemplate?: string;
  /** Short prose shown under the preset name in the picker. */
  hint?: string;
};

/**
 * Common diff and editor presets. The user can tweak the resulting entry
 * in the Custom form before saving — these are just starting points.
 */
const PRESETS: { diff: Preset[]; openWith: Preset[] } = {
  diff: [
    {
      label: 'Kaleidoscope',
      kind: 'cli',
      target: 'file',
      role: 'diff',
      cliPath: 'ksdiff',
      argvTemplate: '{baseline} {current}',
      hint: 'Requires ksdiff helper from the Kaleidoscope menu',
    },
    {
      label: 'VS Code diff',
      kind: 'cli',
      target: 'file',
      role: 'diff',
      cliPath: 'code',
      argvTemplate: '--diff {baseline} {current}',
      hint: 'Requires `code` on PATH (Shell Command: Install in VS Code)',
    },
    {
      label: 'opendiff (FileMerge)',
      kind: 'cli',
      target: 'file',
      role: 'diff',
      cliPath: 'opendiff',
      argvTemplate: '{baseline} {current}',
      hint: 'macOS built-in via Xcode command-line tools',
    },
  ],
  openWith: [
    {
      label: 'VS Code',
      kind: 'app',
      target: 'both',
      appPath: '/Applications/Visual Studio Code.app',
    },
    {
      label: 'Cursor',
      kind: 'app',
      target: 'both',
      appPath: '/Applications/Cursor.app',
    },
    {
      label: 'TextEdit',
      kind: 'app',
      target: 'file',
      appPath: '/System/Applications/TextEdit.app',
    },
  ],
};

export function AppPickerModal({ initial = 'open-with', onSave, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<AppPickerPreselect>(initial);
  const [draft, setDraft] = useState<AppEntry>(() => emptyDraft(tab));
  const [showCustom, setShowCustom] = useState(initial === 'custom');

  const presetList = tab === 'diff' ? PRESETS.diff : PRESETS.openWith;

  const onPresetClick = (preset: Preset): void => {
    onSave({ id: makeId(), ...preset });
  };

  const onCustomSave = (): void => {
    if (!isDraftComplete(draft)) return;
    onSave({ ...draft, id: makeId() });
  };

  return (
    <>
      <div style={backdropStyle} onMouseDown={onClose} data-testid="app-picker-backdrop" />
      <div style={modalStyle} data-testid="app-picker-modal">
        <header style={headerStyle}>
          <h2 style={titleStyle}>
            {tab === 'diff' ? 'Pick a diff app' : 'Pick an app to open files & folders'}
          </h2>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            ✕
          </button>
        </header>

        {initial !== 'custom' ? (
          <div style={tabsStyle}>
            <TabButton
              label="Open with"
              active={tab === 'open-with'}
              onClick={() => {
                setTab('open-with');
                setShowCustom(false);
              }}
            />
            <TabButton
              label="Diff"
              active={tab === 'diff'}
              onClick={() => {
                setTab('diff');
                setShowCustom(false);
              }}
            />
          </div>
        ) : null}

        {!showCustom ? (
          <>
            <div style={presetListStyle} data-testid="app-picker-presets">
              {presetList.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  style={presetButtonStyle}
                  onClick={() => onPresetClick(preset)}
                  data-testid={`app-picker-preset-${slug(preset.label)}`}
                >
                  <div style={presetLabelStyle}>{preset.label}</div>
                  {preset.hint ? <div style={presetHintStyle}>{preset.hint}</div> : null}
                </button>
              ))}
            </div>
            <div style={separatorStyle} />
            <button
              type="button"
              style={customToggleStyle}
              onClick={() => {
                setShowCustom(true);
                setDraft(emptyDraft(tab));
              }}
              data-testid="app-picker-custom-toggle"
            >
              + Custom…
            </button>
          </>
        ) : (
          <CustomForm
            draft={draft}
            onChange={setDraft}
            role={tab === 'diff' ? 'diff' : undefined}
          />
        )}

        {showCustom ? (
          <footer style={footerStyle}>
            <button type="button" onClick={() => setShowCustom(false)} style={cancelBtnStyle}>
              Back
            </button>
            <button
              type="button"
              onClick={onCustomSave}
              disabled={!isDraftComplete(draft)}
              style={{
                ...confirmBtnStyle,
                ...(isDraftComplete(draft) ? null : confirmBtnDisabledStyle),
              }}
              data-testid="app-picker-save"
            >
              Save
            </button>
          </footer>
        ) : null}
      </div>
    </>
  );
}

function CustomForm({
  draft,
  onChange,
  role,
}: {
  draft: AppEntry;
  onChange: (d: AppEntry) => void;
  role?: AppEntry['role'];
}): JSX.Element {
  return (
    <div style={customFormStyle} data-testid="app-picker-custom-form">
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>Label</span>
        <input
          type="text"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          style={inputStyle}
          placeholder="e.g. WebStorm"
          data-testid="app-picker-label"
        />
        <span style={fieldHintStyle}>
          Just the app name — &ldquo;Open with&rdquo; is added by the menu.
        </span>
      </label>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>Kind</span>
        <select
          value={draft.kind}
          onChange={(e) => onChange({ ...draft, kind: e.target.value as AppEntry['kind'] })}
          style={inputStyle}
          data-testid="app-picker-kind"
        >
          <option value="app">macOS .app</option>
          <option value="cli">CLI binary</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>Target</span>
        <select
          value={draft.target}
          onChange={(e) => onChange({ ...draft, target: e.target.value as AppEntry['target'] })}
          style={inputStyle}
          data-testid="app-picker-target"
        >
          <option value="both">File and folder</option>
          <option value="file">File only</option>
          <option value="folder">Folder only</option>
        </select>
      </label>
      {draft.kind === 'app' ? (
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>.app path</span>
          <input
            type="text"
            placeholder="/Applications/YourApp.app"
            value={draft.appPath ?? ''}
            onChange={(e) => onChange({ ...draft, appPath: e.target.value })}
            style={inputStyle}
            data-testid="app-picker-app-path"
          />
        </label>
      ) : (
        <>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>CLI path</span>
            <input
              type="text"
              placeholder="ksdiff, code, /usr/local/bin/foo, …"
              value={draft.cliPath ?? ''}
              onChange={(e) => onChange({ ...draft, cliPath: e.target.value })}
              style={inputStyle}
              data-testid="app-picker-cli-path"
            />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>
              argv template — {role === 'diff' ? '{baseline} {current}' : '{path}'}
            </span>
            <input
              type="text"
              placeholder={role === 'diff' ? '{baseline} {current}' : '{path}'}
              value={draft.argvTemplate ?? ''}
              onChange={(e) => onChange({ ...draft, argvTemplate: e.target.value })}
              style={inputStyle}
              data-testid="app-picker-argv"
            />
          </label>
        </>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...tabButtonStyle, ...(active ? tabButtonActiveStyle : null) }}
    >
      {label}
    </button>
  );
}

function emptyDraft(tab: AppPickerPreselect): AppEntry {
  const isDiff = tab === 'diff';
  return {
    id: '',
    label: '',
    kind: 'cli',
    target: 'file',
    cliPath: '',
    argvTemplate: isDiff ? '{baseline} {current}' : '{path}',
    ...(isDiff ? { role: 'diff' as const } : {}),
  };
}

function isDraftComplete(d: AppEntry): boolean {
  if (d.label.trim().length === 0) return false;
  if (d.kind === 'app') return (d.appPath ?? '').trim().length > 0;
  return (d.cliPath ?? '').trim().length > 0 && (d.argvTemplate ?? '').trim().length > 0;
}

function makeId(): string {
  return `app-${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 5).toString(36)}`;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(520px, 90vw)',
  maxHeight: '85vh',
  overflow: 'auto',
  background: '#0f1620',
  border: '1px solid #2f3a45',
  borderRadius: '8px',
  padding: '1.2rem',
  zIndex: 51,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#dde3ea',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#aab4be',
  fontSize: '1rem',
  cursor: 'pointer',
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  borderBottom: '1px solid #1f2933',
  paddingBottom: '0.25rem',
};

const tabButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#9fb1bd',
  fontSize: '0.82rem',
  fontWeight: 600,
  padding: '0.3rem 0.7rem',
  borderRadius: '4px 4px 0 0',
  cursor: 'pointer',
};

const tabButtonActiveStyle: React.CSSProperties = {
  color: '#dde3ea',
  background: '#0c121a',
  borderBottom: '2px solid #3a78c2',
};

const presetListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const presetButtonStyle: React.CSSProperties = {
  textAlign: 'left',
  background: '#0c121a',
  border: '1px solid #1f2933',
  borderRadius: '5px',
  padding: '0.55rem 0.8rem',
  color: '#dde3ea',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const presetLabelStyle: React.CSSProperties = {
  fontWeight: 600,
};

const presetHintStyle: React.CSSProperties = {
  marginTop: '0.15rem',
  fontSize: '0.74rem',
  color: '#7a8590',
};

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: '#1f2933',
};

const customToggleStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: '1px dashed #2f3a45',
  borderRadius: '5px',
  color: '#9fb1bd',
  padding: '0.35rem 0.85rem',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const customFormStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#9fb1bd',
};

const fieldHintStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#7a8794',
  marginTop: '0.1rem',
};

const inputStyle: React.CSSProperties = {
  background: '#0c121a',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  padding: '0.35rem 0.5rem',
  color: '#dde3ea',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.5rem',
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  padding: '0.35rem 0.85rem',
  color: '#dde3ea',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const confirmBtnStyle: React.CSSProperties = {
  background: '#3a78c2',
  color: '#ffffff',
  border: 'none',
  borderRadius: '5px',
  padding: '0.35rem 0.95rem',
  fontWeight: 600,
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const confirmBtnDisabledStyle: React.CSSProperties = {
  background: '#2a323a',
  color: '#7a8590',
  cursor: 'default',
};
