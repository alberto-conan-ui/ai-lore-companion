import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  BROWSER_PROFILES,
  type BrowserProfile,
  type BrowserStatePayload,
  type Shortcut,
} from '../../../shared/ipc.js';
import { SidebarTab } from './SidebarTab.js';

type Props = {
  /** Stable id — keys this tab's `WebContentsView` in main. */
  tabId: string;
  /** Whether this tab's panel is open and the tab is the active one. */
  visible: boolean;
  /** Configured shortcuts surfaced in the Web-tab sidebar. URL-target entries
   *  become clickable rows that navigate the tab's view. */
  tabShortcuts?: Shortcut[];
  /** Launch a URL shortcut externally in Chrome — the `↗` affordance on each
   *  sidebar row, mirroring the strip's split-button behaviour. */
  onLaunchUrlExternal?: (shortcutId: string) => void;
};

/**
 * A browser tab's chrome — toolbar (nav, URL bar, profile) and a placeholder
 * the tab's `WebContentsView` (owned by `main`) is positioned over. Draws no
 * web content itself: it creates the view on mount, reports the placeholder's
 * bounds, and drives navigation over IPC, all keyed by `tabId`.
 */
export function BrowserTab({
  tabId,
  visible,
  tabShortcuts = [],
  onLaunchUrlExternal,
}: Props): JSX.Element {
  const [state, setState] = useState<BrowserStatePayload | null>(null);
  const [urlText, setUrlText] = useState('');
  const urlFocused = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);

  // Create the view on mount. The view is destroyed when the tab closes or
  // when the window closes.
  useEffect(() => {
    window.cockpit.browserCreate(tabId);
  }, [tabId]);

  // Browser state for *this* tab only.
  useEffect(
    () =>
      window.cockpit.onBrowserState((s) => {
        if (s.tabId === tabId) setState(s);
      }),
    [tabId],
  );

  // Mirror the live URL into the bar — never while the user is editing it.
  useEffect(() => {
    if (state && !urlFocused.current) setUrlText(state.url);
  }, [state]);

  // Show the view when this tab is the visible one; hide it otherwise.
  useEffect(() => {
    window.cockpit.browserSetVisible(tabId, visible);
  }, [tabId, visible]);

  // Feed the placeholder's pixel bounds to main whenever they change.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const send = (): void => {
      const r = el.getBoundingClientRect();
      window.cockpit.browserSetBounds(tabId, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(el);
    window.addEventListener('resize', send);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [tabId]);

  const submitUrl = useCallback(() => {
    window.cockpit.browserNavigate(tabId, urlText);
    urlFocused.current = false;
  }, [tabId, urlText]);

  return (
    <SidebarTab
      testIdPrefix="web-shortcuts"
      defaultWidth={220}
      expandTitle="Show shortcuts"
      collapseTitle="Hide shortcuts"
      hideTitle="Hide shortcuts"
      sidebar={
        <WebShortcutsColumn
          shortcuts={tabShortcuts}
          onPick={(url) => window.cockpit.browserNavigate(tabId, url)}
          onLaunchExternal={(id) => onLaunchUrlExternal?.(id)}
        />
      }
      content={
        <div style={wrapStyle} data-testid="browser-tab">
          <div style={toolbarStyle}>
            <button
              type="button"
              style={navBtn(!state?.canGoBack)}
              disabled={!state?.canGoBack}
              title="Back"
              onClick={() => window.cockpit.browserGoBack(tabId)}
            >
              ‹
            </button>
            <button
              type="button"
              style={navBtn(!state?.canGoForward)}
              disabled={!state?.canGoForward}
              title="Forward"
              onClick={() => window.cockpit.browserGoForward(tabId)}
            >
              ›
            </button>
            <button
              type="button"
              style={navBtn(false)}
              title="Reload"
              onClick={() => window.cockpit.browserReload(tabId)}
            >
              ⟳
            </button>
            <input
              style={urlStyle}
              value={urlText}
              spellCheck={false}
              placeholder="Search or enter address"
              data-testid="browser-url"
              onChange={(e) => setUrlText(e.target.value)}
              onFocus={() => {
                urlFocused.current = true;
              }}
              onBlur={() => {
                urlFocused.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitUrl();
              }}
            />
            <select
              style={profileStyle}
              value={state?.profile ?? BROWSER_PROFILES[0]}
              title="Browser profile"
              data-testid="browser-profile"
              onChange={(e) =>
                window.cockpit.browserSetProfile(tabId, e.target.value as BrowserProfile)
              }
            >
              {BROWSER_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {/* The WebContentsView floats over this — kept empty on purpose. */}
          <div ref={pageRef} style={pageStyle} />
        </div>
      }
    />
  );
}

/** The Web-tab sidebar: each URL-targeted shortcut renders as a row that
 *  navigates this tab's view when clicked. The `↗` button on each row opens
 *  the URL externally (in Chrome), mirroring the strip's split-button. */
function WebShortcutsColumn({
  shortcuts,
  onPick,
  onLaunchExternal,
}: {
  shortcuts: Shortcut[];
  onPick: (url: string) => void;
  onLaunchExternal: (shortcutId: string) => void;
}): JSX.Element {
  const rows = shortcuts.filter((s) => s.target === 'url' && s.url);
  if (rows.length === 0) {
    return (
      <div style={emptyStyle}>
        No URL shortcuts. Add some in <strong>Settings → Shortcuts</strong>.
      </div>
    );
  }
  return (
    <div style={listStyle} data-testid="web-shortcuts-list">
      {rows.map((s) => (
        <div key={s.id} style={rowWrapStyle}>
          <button
            type="button"
            style={rowStyle}
            title={s.url}
            data-testid={`web-shortcut-${s.id}`}
            onClick={() => onPick(s.url ?? '')}
          >
            <span style={labelStyle}>{s.label}</span>
            <span style={urlSubStyle}>{s.url}</span>
          </button>
          <button
            type="button"
            style={externalBtnStyle}
            title={`Open ${s.url} externally in Chrome`}
            data-testid={`web-shortcut-external-${s.id}`}
            onClick={() => onLaunchExternal(s.id)}
          >
            ↗
          </button>
        </div>
      ))}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.4rem 0.5rem',
  background: '#0f1620',
  borderBottom: '1px solid #1f2933',
};

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    width: '1.6rem',
    height: '1.6rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid #2f3a45',
    borderRadius: '4px',
    color: disabled ? '#4a5762' : '#cbd5dd',
    fontSize: '0.9rem',
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
  };
}

const urlStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '1.6rem',
  padding: '0 0.5rem',
  background: '#0a0f17',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#e6edf3',
  fontSize: '0.76rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const profileStyle: React.CSSProperties = {
  flexShrink: 0,
  height: '1.6rem',
  background: '#0a0f17',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#cbd5dd',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const pageStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  background: '#1a1f27',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0.5rem 0',
  gap: '0.2rem',
};

const rowWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  padding: '0.35rem 0.5rem 0.35rem 0.85rem',
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
  color: '#dde3ea',
};

const urlSubStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.72rem',
  color: '#7a8590',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const externalBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 28,
  background: 'transparent',
  border: 'none',
  color: '#7a8590',
  fontSize: '0.85rem',
  cursor: 'pointer',
  padding: '0 0.3rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.85rem',
  fontSize: '0.78rem',
  color: '#6c7783',
  lineHeight: 1.5,
};
