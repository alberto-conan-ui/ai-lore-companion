import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

/** Default + clamping for the sidebar column's width, in px. */
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 160;
/** The content column needs at least this much room. */
const CONTENT_MIN_WIDTH = 240;
/** The always-visible activity rail on the far left, in px. */
const RAIL_WIDTH = 34;

/**
 * Two-column tab body with a WebStorm-style **tool window**: an always-visible
 * vertical icon rail on the far left, a sidebar panel it toggles, and a content
 * surface.
 *
 *   - The rail icon toggles the sidebar open/closed (substitutes the old
 *     expand bar). Active (filled) while the panel is open.
 *   - The open panel is docked — in the flex flow, pushing the content over.
 *   - Drag the divider to resize the panel.
 *   - A × in the panel header closes it (same as clicking the active rail icon).
 *
 * The component is purely structural — callers pass the sidebar and content as
 * JSX, plus the rail `icon` and panel `label`. Width persistence is plumbed
 * through optional `loadWidth` / `saveWidth`; open state is in-session.
 */
export function SidebarTab({
  sidebar,
  content,
  icon,
  label,
  defaultOpen = true,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
  loadWidth,
  saveWidth,
  testIdPrefix = 'sidebar',
  expandTitle = 'Show sidebar',
  collapseTitle = 'Hide sidebar',
  hideTitle = 'Hide sidebar',
}: {
  sidebar: JSX.Element;
  content: JSX.Element;
  /** Glyph shown on the rail icon for this tool window. */
  icon: string;
  /** Short name shown in the panel header (e.g. "Shortcuts", "Prompts"). */
  label: string;
  /** Whether the panel starts open. Tabs whose sidebar has another front-door
   *  (e.g. the `+ shell ▾` / `+ web ▾` shortcut dropdowns) pass `false` so the
   *  pane doesn't take space until the rail icon opens it. */
  defaultOpen?: boolean;
  /** First-open width when no persisted value is available. */
  defaultWidth?: number;
  /** Async loader for the persisted width; returns `null` for none. */
  loadWidth?: () => Promise<number | null>;
  /** Persist the width on drag-end. */
  saveWidth?: (width: number) => void;
  /** Suffix for `data-testid` attributes. Each variant (AI, Shell, Web)
   *  passes a distinct prefix so e2e selectors stay specific. */
  testIdPrefix?: string;
  expandTitle?: string;
  collapseTitle?: string;
  hideTitle?: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState<number>(defaultWidth);
  // The tool window's open state, toggled from the rail. Defaults open unless
  // the caller starts it closed (its sidebar has another way in).
  const [open, setOpen] = useState<boolean>(defaultOpen);

  useEffect(() => {
    if (!loadWidth) return;
    void loadWidth().then((w) => {
      if (w !== null && Number.isFinite(w) && w >= SIDEBAR_MIN_WIDTH) {
        setColumnWidth(w);
      }
    });
  }, [loadWidth]);

  /** Clamp a candidate width against the floor and the parent-derived ceiling.
   *  The rail's fixed strip is reserved out of the available room. */
  const clamp = useCallback((candidate: number): number => {
    const container = containerRef.current;
    const max = container ? container.clientWidth - CONTENT_MIN_WIDTH - RAIL_WIDTH : candidate;
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(candidate, max));
  }, []);

  const handleResizerMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    // The panel's left edge sits just past the rail.
    const panelLeft = container.getBoundingClientRect().left + RAIL_WIDTH;
    const startX = e.clientX;
    // Coalesce mousemove → at most one width update per animation frame. A fast
    // drag fires mousemove far quicker than the screen paints; updating the width
    // state every event thrashes the content's ResizeObservers (xterm fit, grid
    // relayout, the file tree's windowing) and is what made resizing feel laggy.
    let frame = 0;
    let latestX = startX;
    const apply = (): void => {
      frame = 0;
      setColumnWidth(clamp(latestX - panelLeft));
    };
    const onMove = (ev: MouseEvent): void => {
      latestX = ev.clientX;
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    const onUp = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Settle on the final pointer position and persist it.
      const settled = clamp(latestX - panelLeft);
      setColumnWidth(settled);
      if (saveWidth) saveWidth(settled);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={containerRef}
      style={splitContainerStyle}
      data-testid={`${testIdPrefix}-tab`}
      data-sidebar-state={open ? 'open' : 'closed'}
    >
      <div style={railStyle} data-testid={`${testIdPrefix}-rail`}>
        <button
          type="button"
          style={open ? railIconActiveStyle : railIconStyle}
          title={open ? collapseTitle : expandTitle}
          aria-label={open ? collapseTitle : expandTitle}
          aria-pressed={open}
          data-testid={`${testIdPrefix}-rail-icon`}
          onClick={() => setOpen((o) => !o)}
        >
          {icon}
        </button>
      </div>
      {open ? (
        <>
          <div
            style={{ ...sidebarColumnStyle, width: columnWidth }}
            data-testid={`${testIdPrefix}-column`}
            data-sidebar-width={columnWidth}
          >
            <div style={panelHeaderStyle}>
              <span style={panelLabelStyle}>{label}</span>
              <button
                type="button"
                style={headerBtnStyle}
                title={hideTitle}
                aria-label={hideTitle}
                data-testid={`${testIdPrefix}-close`}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div style={sidebarBodyStyle}>{sidebar}</div>
          </div>
          <button
            type="button"
            style={resizerStyle}
            data-testid={`${testIdPrefix}-resizer`}
            aria-label={collapseTitle}
            title={`Drag to resize · ${collapseTitle.toLowerCase()} from the rail`}
            onMouseDown={handleResizerMouseDown}
          />
        </>
      ) : null}
      <div style={contentColumnStyle}>{content}</div>
    </div>
  );
}

const splitContainerStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: '#0a0f17',
};

const railStyle: React.CSSProperties = {
  flexShrink: 0,
  width: RAIL_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 6,
  gap: 4,
  background: '#0a0f17',
  borderRight: '1px solid #1a2230',
};

const railIconStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 5,
  color: '#7a8590',
  fontSize: '0.95rem',
  cursor: 'pointer',
  padding: 0,
};

const railIconActiveStyle: React.CSSProperties = {
  ...railIconStyle,
  background: '#16202c',
  border: '1px solid #28384a',
  color: '#cfd8e0',
};

const sidebarColumnStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: '#0c121a',
  borderRight: '1px solid #1a2230',
  position: 'relative',
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 26,
  flexShrink: 0,
  padding: '0 4px 0 8px',
  borderBottom: '1px solid #161e29',
};

const panelLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '0.64rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#6c7783',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const headerBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 18,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: '#6c7783',
  fontSize: '0.85rem',
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  borderRadius: 3,
};

const sidebarBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const resizerStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '4px',
  background: '#1a2230',
  cursor: 'col-resize',
  border: 'none',
  padding: 0,
  color: 'transparent',
};

const contentColumnStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
};
