import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  BROWSER_PROFILES,
  type BrowserProfile,
  type BrowserStatePayload,
} from '../../../shared/ipc.js';

type Props = {
  /** Stable id — keys this tab's `WebContentsView` in main. */
  tabId: string;
  /** Whether this tab's panel is open and the tab is the active one. */
  visible: boolean;
};

/**
 * A browser tab's chrome — toolbar (nav, URL bar, profile) and a placeholder
 * the tab's `WebContentsView` (owned by `main`) is positioned over. Draws no
 * web content itself: it creates the view on mount, reports the placeholder's
 * bounds, and drives navigation over IPC, all keyed by `tabId`.
 */
export function BrowserTab({ tabId, visible }: Props): JSX.Element {
  const [state, setState] = useState<BrowserStatePayload | null>(null);
  const [urlText, setUrlText] = useState('');
  const urlFocused = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);

  // Create the view on mount (idempotent in main). It is destroyed by the
  // shell when the tab is closed, or by main when the window closes.
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
