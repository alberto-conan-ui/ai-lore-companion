import { type JSX, useEffect, useState } from 'react';
import type { Shortcut, ShortcutTarget } from '../../../shared/ipc.js';

/**
 * The "This project" section of a tab sidebar: quick shortcuts scoped to the
 * window's project (stored per-project in main, not the global list). Add &
 * remove only — click a row to use it (`onUse`), `×` to remove, `+ Add` for a
 * tiny inline form. `target` selects which kind this section manages: `url`
 * for the Web sidebar, `terminal` (a command) for the Shell sidebar.
 */
export function ProjectShortcuts({
  target,
  valuePlaceholder,
  onUse,
  testIdPrefix,
}: {
  target: Extract<ShortcutTarget, 'url' | 'terminal'>;
  /** Placeholder for the value field — e.g. `https://…` or `npm run dev`. */
  valuePlaceholder: string;
  onUse: (shortcut: Shortcut) => void;
  testIdPrefix: string;
}): JSX.Element {
  const [list, setList] = useState<Shortcut[]>([]);
  // null = form closed; `{ id: null }` = adding; `{ id }` = editing that shortcut.
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    void window.cockpit.projectShortcutsList().then(setList);
    return window.cockpit.onProjectShortcutsChanged(setList);
  }, []);

  const rows = list.filter((s) => s.target === target);

  const shortcutValue = (s: Shortcut): string =>
    target === 'url' ? (s.url ?? '') : (s.command ?? '');

  const openAdd = (): void => {
    setForm({ id: null });
    setLabel('');
    setValue('');
  };

  const openEdit = (s: Shortcut): void => {
    setForm({ id: s.id });
    setLabel(s.label);
    setValue(shortcutValue(s));
  };

  const cancel = (): void => {
    setForm(null);
    setLabel('');
    setValue('');
  };

  const submit = (): void => {
    const l = label.trim();
    const v = value.trim();
    if (!form || !l || !v) return;
    const input =
      target === 'url' ? { label: l, target, url: v } : { label: l, target, command: v };
    if (form.id) void window.cockpit.projectShortcutsUpdate(form.id, input).then(setList);
    else void window.cockpit.projectShortcutsAdd(input).then(setList);
    cancel();
  };

  const remove = (s: Shortcut): void => {
    if (!window.confirm(`Remove "${s.label}" from this project?`)) return;
    void window.cockpit.projectShortcutsRemove(s.id).then(setList);
  };

  return (
    <div style={sectionStyle} data-testid={`${testIdPrefix}-project-shortcuts`}>
      <div style={headerStyle}>This project</div>
      {rows.map((s) => (
        <div key={s.id} style={rowWrapStyle}>
          <button
            type="button"
            style={rowStyle}
            title={shortcutValue(s)}
            data-testid={`${testIdPrefix}-project-shortcut-${s.id}`}
            onClick={() => onUse(s)}
          >
            <span style={labelStyle}>{s.label}</span>
            <span style={valueStyle}>{shortcutValue(s)}</span>
          </button>
          <button
            type="button"
            style={iconBtnStyle}
            title="Edit"
            aria-label="Edit"
            data-testid={`${testIdPrefix}-project-shortcut-edit-${s.id}`}
            onClick={() => openEdit(s)}
          >
            ✎
          </button>
          <button
            type="button"
            style={iconBtnStyle}
            title="Remove from this project"
            aria-label="Remove"
            data-testid={`${testIdPrefix}-project-shortcut-remove-${s.id}`}
            onClick={() => remove(s)}
          >
            ×
          </button>
        </div>
      ))}
      {form ? (
        <div style={formStyle}>
          <input
            style={inputStyle}
            placeholder="Label"
            value={label}
            // biome-ignore lint/a11y/noAutofocus: opening the form should land the cursor.
            autoFocus
            data-testid={`${testIdPrefix}-project-shortcut-label`}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') cancel();
            }}
          />
          <input
            style={inputStyle}
            placeholder={valuePlaceholder}
            value={value}
            data-testid={`${testIdPrefix}-project-shortcut-value`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') cancel();
            }}
          />
          <div style={formButtonsStyle}>
            <button
              type="button"
              style={addBtnStyle}
              data-testid={`${testIdPrefix}-project-shortcut-save`}
              onClick={submit}
            >
              {form.id ? 'Save' : 'Add'}
            </button>
            <button type="button" style={cancelBtnStyle} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={addRowStyle}
          data-testid={`${testIdPrefix}-project-shortcut-add`}
          onClick={openAdd}
        >
          + Add shortcut
        </button>
      )}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderTop: '1px solid var(--color-border-rail)',
  marginTop: '0.4rem',
  paddingTop: '0.3rem',
};

const headerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  padding: '0.25rem 0.85rem',
};

const rowWrapStyle: React.CSSProperties = { display: 'flex', alignItems: 'stretch' };

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  padding: '0.3rem 0.5rem 0.3rem 0.85rem',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  flex: 1,
  minWidth: 0,
  font: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
  color: 'var(--color-text)',
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.72rem',
  color: 'var(--color-text-soft)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const iconBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 24,
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '0.85rem',
  cursor: 'pointer',
  padding: 0,
};

const addRowStyle: React.CSSProperties = {
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-dim)',
  fontSize: '0.76rem',
  cursor: 'pointer',
  padding: '0.35rem 0.85rem',
  font: 'inherit',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.35rem 0.6rem 0.5rem 0.85rem',
};

const inputStyle: React.CSSProperties = {
  height: '1.5rem',
  padding: '0 0.4rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-bright)',
  fontSize: '0.75rem',
};

const formButtonsStyle: React.CSSProperties = { display: 'flex', gap: '0.3rem' };

const addBtnStyle: React.CSSProperties = {
  background: 'var(--color-shortcut-active)',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-on-accent)',
  fontSize: '0.74rem',
  cursor: 'pointer',
  padding: '0.2rem 0.6rem',
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  cursor: 'pointer',
  padding: '0.2rem 0.6rem',
};
