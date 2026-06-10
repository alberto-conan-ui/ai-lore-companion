import { type JSX, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Per-row copy affordance (Read-only IDE P4): a small button beside a file row
 * that opens a dropdown to copy the file's name or its full path. Hover-revealed
 * via the shared `.row-kebab` class; the menu portals to `document.body` with
 * fixed coordinates so it escapes the virtualized/clipped grid cell. Copy goes
 * through Electron's clipboard (`window.cockpit.copyText`).
 */
export function RowCopyMenu({ name, path }: { name: string; path: string }): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const open = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.right, y: r.bottom + 2 });
  };
  const copy = (text: string): void => {
    window.cockpit.copyText(text);
    setMenu(null);
  };

  return (
    <>
      <button
        type="button"
        className="row-kebab"
        title="Copy name or path"
        aria-label="Copy name or path"
        onClick={open}
      >
        ⧉
      </button>
      {menu
        ? createPortal(
            <>
              <div style={backdropStyle} onMouseDown={() => setMenu(null)} />
              {/* Right-aligned to the button so it never spills off the grid's
                  right edge. */}
              <div
                style={{ ...menuStyle, left: menu.x, top: menu.y, transform: 'translateX(-100%)' }}
                role="menu"
                data-testid="row-copy-menu"
              >
                <button type="button" style={itemStyle} onClick={() => copy(name)}>
                  Copy file name
                </button>
                <button type="button" style={itemStyle} onClick={() => copy(path)}>
                  Copy full path
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
};

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 61,
  background: '#121a24',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  padding: '0.2rem',
  minWidth: '9rem',
};

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.78rem',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};
