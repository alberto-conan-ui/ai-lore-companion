import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

/** Default + clamping for the sidebar column's width, in px. */
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 160;
/** The content column needs at least this much room. */
const CONTENT_MIN_WIDTH = 240;

/**
 * Two-column tab body: a sidebar on the left, a content surface on the right,
 * with a resizable divider between them.
 *
 *   - Drag the divider to resize the sidebar.
 *   - Click the divider (no drag) to collapse the sidebar to a thin chevron;
 *     click the chevron to restore.
 *   - A small × button at the sidebar's top-right also collapses it.
 *
 * The component is purely structural — callers pass the sidebar and content
 * as JSX. Width persistence is plumbed through optional `loadWidth` /
 * `saveWidth` callbacks; without them the column starts at `defaultWidth`
 * and the user's drag is in-session only.
 */
export function SidebarTab({
  sidebar,
  content,
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
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const movedRef = useRef(false);

  useEffect(() => {
    if (!loadWidth) return;
    void loadWidth().then((w) => {
      if (w !== null && Number.isFinite(w) && w >= SIDEBAR_MIN_WIDTH) {
        setColumnWidth(w);
      }
    });
  }, [loadWidth]);

  /** Clamp a candidate width against the floor and the parent-derived ceiling. */
  const clamp = useCallback((candidate: number): number => {
    const container = containerRef.current;
    const max = container ? container.clientWidth - CONTENT_MIN_WIDTH : candidate;
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(candidate, max));
  }, []);

  const handleResizerMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    movedRef.current = false;
    if (collapsed) return;
    const container = containerRef.current;
    if (!container) return;
    const containerLeft = container.getBoundingClientRect().left;
    const startX = e.clientX;
    const onMove = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - startX) > 3) movedRef.current = true;
      setColumnWidth(clamp(ev.clientX - containerLeft));
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setColumnWidth((current) => {
        if (saveWidth) saveWidth(current);
        return current;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleResizerClick = (): void => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setCollapsed((c) => !c);
  };

  return (
    <div
      ref={containerRef}
      style={splitContainerStyle}
      data-testid={`${testIdPrefix}-tab`}
      data-sidebar-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <div
        style={{
          ...sidebarColumnStyle,
          width: collapsed ? 0 : columnWidth,
          display: collapsed ? 'none' : 'flex',
        }}
        data-testid={`${testIdPrefix}-column`}
        data-sidebar-width={collapsed ? 0 : columnWidth}
        data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      >
        <button
          type="button"
          style={closeBtnStyle}
          title={hideTitle}
          aria-label={hideTitle}
          data-testid={`${testIdPrefix}-close`}
          onClick={() => setCollapsed(true)}
        >
          ×
        </button>
        {sidebar}
      </div>
      <button
        type="button"
        style={collapsed ? resizerCollapsedStyle : resizerStyle}
        data-testid={`${testIdPrefix}-resizer`}
        aria-label={collapsed ? expandTitle : collapseTitle}
        aria-expanded={!collapsed}
        title={
          collapsed
            ? expandTitle
            : `Drag to resize · click to ${collapseTitle.toLowerCase()}`
        }
        onMouseDown={handleResizerMouseDown}
        onClick={handleResizerClick}
      >
        {collapsed ? '›' : ''}
      </button>
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

const sidebarColumnStyle: React.CSSProperties = {
  flexShrink: 0,
  overflowY: 'auto',
  background: '#0c121a',
  borderRight: '1px solid #1a2230',
  position: 'relative',
};

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 18,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: '#6c7783',
  fontSize: '0.95rem',
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  borderRadius: 3,
  zIndex: 1,
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

const resizerCollapsedStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '14px',
  background: '#1a2230',
  cursor: 'pointer',
  border: 'none',
  padding: 0,
  color: '#7a8590',
  fontSize: '0.85rem',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const contentColumnStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
};
