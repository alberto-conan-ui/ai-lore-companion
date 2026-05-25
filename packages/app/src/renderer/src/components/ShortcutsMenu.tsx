import { type JSX, useEffect, useRef, useState } from 'react';
import type { Shortcut } from '../../../shared/ipc.js';
import { ActionButton } from './ActionButton.js';

/**
 * Header launcher for app-launch shortcuts. A click opens a popover listing
 * the configured shortcuts; clicking a row runs it. Add / edit / remove live
 * in the Settings sheet's Shortcuts section — a "Manage in Settings…" link at
 * the foot of the popover opens it there. The list is global —
 * `onShortcutsChanged` keeps every window's launcher in sync.
 */
export function ShortcutsMenu({
  onManage,
}: {
  /** Open the Settings sheet on the Shortcuts section. */
  onManage: () => void;
}): JSX.Element {
  const [list, setList] = useState<Shortcut[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.cockpit.shortcutsList().then(setList);
    return window.cockpit.onShortcutsChanged(setList);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Browser tabs are native `WebContentsView`s — they render above the DOM
    // popover and eat its clicks. Hide them while the launcher is open.
    window.cockpit.browserSuppressAll(true);
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.cockpit.browserSuppressAll(false);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <ActionButton
        icon="⚡"
        label="Shortcuts"
        title="App-launch shortcuts"
        testId="shortcuts-menu"
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div style={popoverStyle} data-testid="shortcuts-popover">
          {list.length === 0 ? (
            <div style={emptyStyle}>No shortcuts yet.</div>
          ) : (
            list.map((s) => (
              <button
                key={s.id}
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
            ))
          )}
          <div style={dividerStyle} />
          <button
            type="button"
            style={manageStyle}
            data-testid="shortcuts-manage"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Manage in Settings…
          </button>
        </div>
      ) : null}
    </div>
  );
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 10,
  width: '260px',
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

const runStyle: React.CSSProperties = {
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

const dividerStyle: React.CSSProperties = {
  height: '1px',
  background: '#2f3a45',
  margin: '0.25rem 0',
};

const manageStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.35rem 0.5rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: '#5a9bd4',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
};
