import { type JSX, type ReactNode, useCallback, useRef, useState } from 'react';

type Side = 'right' | 'bottom';

type Props = {
  side: Side;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
};

const MIN = 200;
const DEFAULT_RIGHT = 480;
const DEFAULT_BOTTOM = 240;

/**
 * A collapsible, resizable dock. `side='right'` docks to the window's right
 * edge and resizes horizontally; `side='bottom'` spans the full width and
 * resizes vertically. The handle is always visible — click it to toggle,
 * drag it to resize. Children stay mounted while collapsed, so terminals keep
 * their PTY and browsers their page.
 */
export function DockPanel({ side, open, onToggle, children }: Props): JSX.Element {
  const [size, setSize] = useState(side === 'right' ? DEFAULT_RIGHT : DEFAULT_BOTTOM);
  const movedRef = useRef(false);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!open) return; // collapsed: the handle is a pure click-to-open target
      e.preventDefault();
      movedRef.current = false;
      const start = side === 'right' ? e.clientX : e.clientY;
      const startSize = size;
      const onMove = (ev: MouseEvent): void => {
        const cur = side === 'right' ? ev.clientX : ev.clientY;
        if (Math.abs(cur - start) > 3) movedRef.current = true;
        setSize(Math.max(MIN, startSize + (start - cur)));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [open, side, size],
  );

  const onHandleClick = useCallback(() => {
    // A drag that moved is a resize, not a toggle.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    onToggle(!open);
  }, [open, onToggle]);

  const chevron = side === 'right' ? (open ? '›' : '‹') : open ? '⌄' : '⌃';
  const contentStyle: React.CSSProperties = {
    display: open ? 'flex' : 'none',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    ...(side === 'right' ? { width: size } : { height: size }),
  };

  return (
    <aside style={side === 'right' ? rightAside : bottomAside} data-testid={`dock-${side}`}>
      <button
        type="button"
        style={side === 'right' ? rightHandle : bottomHandle}
        title={open ? 'Drag to resize · click to collapse' : 'Open panel'}
        data-testid={`dock-handle-${side}`}
        onMouseDown={onHandleMouseDown}
        onClick={onHandleClick}
      >
        {chevron}
      </button>
      <div style={contentStyle}>{children}</div>
    </aside>
  );
}

const rightAside: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  flexShrink: 0,
};

const bottomAside: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  flexShrink: 0,
};

const rightHandle: React.CSSProperties = {
  flexShrink: 0,
  width: '16px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0f1620',
  border: 'none',
  borderLeft: '1px solid #1f2933',
  color: '#6c7783',
  fontSize: '0.8rem',
  cursor: 'ew-resize',
  padding: 0,
};

const bottomHandle: React.CSSProperties = {
  flexShrink: 0,
  width: '100%',
  height: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0f1620',
  border: 'none',
  borderTop: '1px solid #1f2933',
  color: '#6c7783',
  fontSize: '0.8rem',
  cursor: 'ns-resize',
  padding: 0,
};
