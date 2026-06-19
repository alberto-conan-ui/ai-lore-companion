import { type JSX, type ReactNode, useCallback, useEffect, useRef } from 'react';

type Side = 'right' | 'bottom';

type Props = {
  side: Side;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** The dock's current size in pixels — width for `right`, height for `bottom`. */
  size: number;
  /** Live resize updates as the user drags the handle. */
  onResize: (size: number) => void;
  /** The project's accent colour — the click-to-toggle handle wears it. */
  accent: string;
  /** The project's dark background tint — the handle's background. */
  tint: string;
  children: ReactNode;
};

export const DOCK_MIN_SIZE = 200;
export const DOCK_DEFAULT_RIGHT = 480;
export const DOCK_DEFAULT_BOTTOM = 240;

/**
 * A collapsible, resizable dock. `side='right'` docks to the window's right
 * edge and resizes horizontally; `side='bottom'` spans the full width and
 * resizes vertically. The handle is always visible — click it to toggle,
 * drag it to resize. Children stay mounted while collapsed, so terminals keep
 * their PTY and browsers their page.
 *
 * The dock is controlled — the parent owns `size` and `open` so they can be
 * captured to the workspace-layout snapshot and restored on the next open.
 */
export function DockPanel({
  side,
  open,
  onToggle,
  size,
  onResize,
  accent,
  tint,
  children,
}: Props): JSX.Element {
  const movedRef = useRef(false);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!open) return; // collapsed: the handle is a pure click-to-open target
      e.preventDefault();
      movedRef.current = false;
      const start = side === 'right' ? e.clientX : e.clientY;
      const startSize = size;
      // Cap the dock at ~65% of the available axis so it can never crush the
      // main area to zero. Re-read on every move so a window resize mid-drag
      // is respected. The min ensures a tiny window still leaves room.
      const maxSize = (): number => {
        const axis = side === 'right' ? window.innerWidth : window.innerHeight;
        return Math.max(DOCK_MIN_SIZE, Math.floor(axis * 0.65));
      };
      const onMove = (ev: MouseEvent): void => {
        const cur = side === 'right' ? ev.clientX : ev.clientY;
        if (Math.abs(cur - start) > 3) movedRef.current = true;
        const next = startSize + (start - cur);
        onResize(Math.max(DOCK_MIN_SIZE, Math.min(maxSize(), next)));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [open, side, size, onResize],
  );

  // If the window shrinks while the dock is open, clamp the stored size so
  // the dock can't outgrow its container. Bad persisted state (the v0.6 bug
  // where rightSize drifted to thousands of pixels) gets healed on open too.
  useEffect(() => {
    if (!open) return;
    const clamp = (): void => {
      const axis = side === 'right' ? window.innerWidth : window.innerHeight;
      const cap = Math.max(DOCK_MIN_SIZE, Math.floor(axis * 0.65));
      if (size > cap) onResize(cap);
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [open, side, size, onResize]);

  const onHandleClick = useCallback(() => {
    // A drag that moved is a resize, not a toggle.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    onToggle(!open);
  }, [open, onToggle]);

  const chevron = side === 'right' ? (open ? '›' : '‹') : open ? '⌄' : '⌃';
  // The toggle handle wears the project's hue — same signal as the header.
  const handleStyle: React.CSSProperties = {
    ...(side === 'right' ? rightHandle : bottomHandle),
    background: tint,
    color: accent,
    ...(side === 'right'
      ? { borderLeft: `1px solid ${accent}` }
      : { borderTop: `1px solid ${accent}` }),
  };
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
        style={handleStyle}
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
  width: '22px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-header)',
  border: 'none',
  borderLeft: '1px solid var(--color-border)',
  color: 'var(--color-text-2)',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'ew-resize',
  padding: 0,
};

const bottomHandle: React.CSSProperties = {
  flexShrink: 0,
  width: '100%',
  height: '22px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-header)',
  border: 'none',
  borderTop: '1px solid var(--color-border)',
  color: 'var(--color-text-2)',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'ns-resize',
  padding: 0,
};
