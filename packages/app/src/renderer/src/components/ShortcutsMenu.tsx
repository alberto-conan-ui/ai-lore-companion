import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { Shortcut, ShortcutInput, ShortcutTarget } from '../../../shared/ipc.js';

/** App name from a `/Applications/Foo.app` path. */
function appName(appPath: string): string {
  return (appPath.split('/').pop() ?? appPath).replace(/\.app$/i, '');
}

type Draft = { target: ShortcutTarget; app: string; url: string; labelInput: string };

function defaultLabel(draft: Draft): string {
  if (draft.target === 'url') return draft.url.trim() || 'URL shortcut';
  const where = draft.target === 'lore' ? 'Lore' : 'project';
  return draft.app ? `Open ${where} in ${appName(draft.app)}` : `Open ${where}`;
}

const TARGETS: { id: ShortcutTarget; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'lore', label: 'Lore' },
  { id: 'url', label: 'URL' },
];

/**
 * Header menu of app-launch shortcuts. A shortcut opens an app on the project
 * or Lore folder, or a URL in Chrome. The list is global — `onShortcutsChanged`
 * keeps every window's menu in sync.
 */
export function ShortcutsMenu(): JSX.Element {
  const [list, setList] = useState<Shortcut[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.cockpit.shortcutsList().then(setList);
    return window.cockpit.onShortcutsChanged(setList);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pickApp = useCallback(async () => {
    const app = await window.cockpit.shortcutsPickApp();
    if (app) setDraft((d) => (d ? { ...d, app } : d));
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const label = draft.labelInput.trim() || defaultLabel(draft);
    const input: ShortcutInput =
      draft.target === 'url'
        ? { label, target: 'url', url: draft.url.trim() }
        : { label, target: draft.target, app: draft.app };
    void window.cockpit.shortcutsAdd(input).then(setList);
    setDraft(null);
  }, [draft]);

  const canSave = draft
    ? draft.target === 'url'
      ? draft.url.trim() !== ''
      : draft.app !== ''
    : false;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={triggerStyle}
        data-testid="shortcuts-menu"
        title="App-launch shortcuts"
        onClick={() => setOpen((v) => !v)}
      >
        ⚡ Shortcuts
      </button>
      {open ? (
        <div style={popoverStyle} data-testid="shortcuts-popover">
          {list.length === 0 ? (
            <div style={emptyStyle}>No shortcuts yet.</div>
          ) : (
            list.map((s) => (
              <div key={s.id} style={rowStyle}>
                <button
                  type="button"
                  style={runStyle}
                  data-testid="shortcut-run"
                  onClick={() => {
                    window.cockpit.shortcutsRun(s.id);
                    setOpen(false);
                  }}
                >
                  {s.label}
                </button>
                <button
                  type="button"
                  style={removeStyle}
                  title="Remove shortcut"
                  onClick={() => void window.cockpit.shortcutsRemove(s.id).then(setList)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
          <div style={dividerStyle} />
          {draft ? (
            <div style={formStyle}>
              <div style={{ display: 'flex', gap: '0.7rem' }}>
                {TARGETS.map((t) => (
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
                <input
                  style={textInputStyle}
                  value={draft.url}
                  placeholder="https://example.com"
                  spellCheck={false}
                  data-testid="shortcut-url"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button type="button" style={chooseAppStyle} onClick={() => void pickApp()}>
                    Choose app…
                  </button>
                  {draft.app ? <span style={appNameStyle}>{appName(draft.app)}</span> : null}
                </div>
              )}
              <input
                style={textInputStyle}
                value={draft.labelInput}
                placeholder={defaultLabel(draft)}
                onChange={(e) => setDraft({ ...draft, labelInput: e.target.value })}
              />
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
              style={addStyle}
              data-testid="shortcut-add"
              onClick={() => setDraft({ target: 'project', app: '', url: '', labelInput: '' })}
            >
              + Add shortcut
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.3rem 0.6rem',
  background: 'transparent',
  color: '#9fb1bd',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 10,
  width: '280px',
  padding: '0.4rem',
  background: '#121a24',
  border: '1px solid #2f3a45',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  color: '#6c7783',
  fontSize: '0.76rem',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
};

const runStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  padding: '0.35rem 0.5rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.78rem',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const removeStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '1.4rem',
  height: '1.4rem',
  background: 'transparent',
  border: 'none',
  color: '#6c7783',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  background: '#2f3a45',
  margin: '0.25rem 0',
};

const addStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: '#5a9bd4',
  fontSize: '0.78rem',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '0.4rem 0.5rem',
};

const appNameStyle: React.CSSProperties = {
  color: '#e6edf3',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  color: '#cbd5dd',
  fontSize: '0.76rem',
  cursor: 'pointer',
};

const textInputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: '#0a0f17',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#e6edf3',
  fontSize: '0.76rem',
};

const chooseAppStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  background: '#1c2c3e',
  border: '1px solid #2f4860',
  borderRadius: '4px',
  color: '#cbd5dd',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  background: '#3a78c2',
  border: 'none',
  borderRadius: '4px',
  color: '#ffffff',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const saveDisabledStyle: React.CSSProperties = {
  ...saveBtnStyle,
  background: '#2a323a',
  color: '#7a8590',
  cursor: 'default',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  background: '#2a323a',
  border: 'none',
  borderRadius: '4px',
  color: '#cbd5dd',
  fontSize: '0.76rem',
  cursor: 'pointer',
};
