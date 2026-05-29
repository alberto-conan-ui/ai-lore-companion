import { type BrowserWindow, WebContentsView } from 'electron';
import {
  type BrowserBounds,
  type BrowserProfile,
  type BrowserStatePayload,
  CHANNELS,
} from '../shared/ipc.js';

/**
 * Browser tabs — each is a `WebContentsView` overlaid on a project window and
 * positioned by the pixel bounds the renderer reports. `main` owns the views;
 * the renderer owns layout. One companion per browser tab, keyed by the tab id
 * the renderer assigns, created on the tab's first mount and destroyed when the
 * tab closes or its window closes.
 *
 * Profiles are session isolation: each profile loads in its own `persist:`
 * partition, so cookies, storage, and logins never cross between them.
 */

type Companion = {
  view: WebContentsView;
  win: BrowserWindow;
  profile: BrowserProfile;
  /** Last bounds the renderer reported; re-applied on show and profile swap. */
  bounds: BrowserBounds;
  /** The renderer's intended visibility for this tab. */
  visible: boolean;
  /** A DOM overlay is occluding the window — force the view hidden regardless of `visible`. */
  suppressed: boolean;
};

const companions = new Map<string, Companion>();

/**
 * Push a companion's effective visibility to its native view. A view shows
 * only when the renderer wants it (`visible`) and no DOM overlay is suppressing
 * it. Bounds are re-applied on show — a hidden view can drift stale bounds.
 */
function applyVisibility(c: Companion): void {
  const shown = c.visible && !c.suppressed;
  c.view.setVisible(shown);
  if (shown) c.view.setBounds(c.bounds);
}

/** Where a freshly opened browser tab lands. */
const HOME_URL = 'https://www.google.com';

function partitionFor(profile: BrowserProfile): string {
  return `persist:browser-${profile}`;
}

/**
 * Turn raw URL-bar input into a URL: an explicit `http(s)://` is kept, a bare
 * host gets `https://`, anything else becomes a Google search.
 */
function normalizeUrl(input: string): string {
  const s = input.trim();
  if (s === '') return HOME_URL;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s.]+(\.[^\s.]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function pushState(tabId: string, c: Companion): void {
  if (c.win.isDestroyed()) return;
  const wc = c.view.webContents;
  const state: BrowserStatePayload = {
    tabId,
    url: wc.getURL(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
    profile: c.profile,
  };
  c.win.webContents.send(CHANNELS.onBrowserState, state);
}

function buildView(
  tabId: string,
  win: BrowserWindow,
  profile: BrowserProfile,
  initialUrl: string,
): Companion {
  const view = new WebContentsView({
    webPreferences: { partition: partitionFor(profile) },
  });
  const c: Companion = {
    view,
    win,
    profile,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    visible: false,
    suppressed: false,
  };

  const wc = view.webContents;
  const update = (): void => pushState(tabId, c);
  for (const e of [
    'did-navigate',
    'did-navigate-in-page',
    'did-start-loading',
    'did-stop-loading',
    'page-title-updated',
  ] as const) {
    wc.on(e, update);
  }

  void wc.loadURL(initialUrl);
  return c;
}

/**
 * Create a browser tab's view (idempotent — a known tab id is a no-op). An
 * `initialUrl` overrides the home page — used to restore a persisted layout.
 */
export function create(
  win: BrowserWindow,
  tabId: string,
  profile: BrowserProfile,
  initialUrl?: string,
): void {
  if (companions.has(tabId)) return;
  const c = buildView(tabId, win, profile, initialUrl ?? HOME_URL);
  win.contentView.addChildView(c.view);
  c.view.setVisible(false);
  companions.set(tabId, c);
}

/** The live URL of a browser tab, or `null` for an unknown tab. */
export function getUrl(tabId: string): string | null {
  const c = companions.get(tabId);
  if (!c || c.win.isDestroyed()) return null;
  return c.view.webContents.getURL();
}

/** Destroy a browser tab's view — the tab was closed. */
export function destroy(tabId: string): void {
  const c = companions.get(tabId);
  if (!c) return;
  companions.delete(tabId);
  if (!c.win.isDestroyed()) c.win.contentView.removeChildView(c.view);
  c.view.webContents.close();
}

/** Show or hide a browser tab's view. */
export function setVisible(tabId: string, visible: boolean): void {
  const c = companions.get(tabId);
  if (!c) return;
  c.visible = visible;
  applyVisibility(c);
  if (visible) pushState(tabId, c);
}

/** Position a browser tab's view. The renderer is the source of layout truth. */
export function setBounds(tabId: string, bounds: BrowserBounds): void {
  const c = companions.get(tabId);
  if (!c) return;
  c.bounds = bounds;
  if (c.visible && !c.suppressed) c.view.setBounds(bounds);
}

/**
 * Hide every browser view in a window, or restore them. A `WebContentsView`
 * renders above all DOM *and* intercepts the clicks landing on it, so a DOM
 * overlay (a menu, a dialog) is both invisible and dead behind one. The
 * renderer calls this around such an overlay; each view's intended visibility
 * is preserved and restored.
 */
export function suppressAll(winId: number, suppress: boolean): void {
  for (const c of companions.values()) {
    if (c.win.id !== winId) continue;
    c.suppressed = suppress;
    applyVisibility(c);
  }
}

export function navigate(tabId: string, url: string): void {
  const c = companions.get(tabId);
  if (c) void c.view.webContents.loadURL(normalizeUrl(url));
}

export function goBack(tabId: string): void {
  companions.get(tabId)?.view.webContents.navigationHistory.goBack();
}

export function goForward(tabId: string): void {
  companions.get(tabId)?.view.webContents.navigationHistory.goForward();
}

export function reload(tabId: string): void {
  companions.get(tabId)?.view.webContents.reload();
}

/** Swap a tab's profile: tear down its view, build a fresh one in the new partition. */
export function setProfile(tabId: string, profile: BrowserProfile): void {
  const old = companions.get(tabId);
  if (!old) return;
  const { win, bounds, visible, suppressed } = old;
  // Carry the current URL across the partition swap — the user expects the
  // page to stay on the tab when they only changed its profile.
  const currentUrl = old.view.webContents.getURL();
  if (!win.isDestroyed()) win.contentView.removeChildView(old.view);
  old.view.webContents.close();

  const c = buildView(tabId, win, profile, currentUrl || HOME_URL);
  c.bounds = bounds;
  c.visible = visible;
  c.suppressed = suppressed;
  win.contentView.addChildView(c.view);
  applyVisibility(c);
  companions.set(tabId, c);
  pushState(tabId, c);
}

/** Destroy every browser tab belonging to a window — called when it closes. */
export function destroyForWindow(winId: number): void {
  for (const [tabId, c] of companions) {
    if (c.win.id === winId) {
      companions.delete(tabId);
      c.view.webContents.close();
    }
  }
}
