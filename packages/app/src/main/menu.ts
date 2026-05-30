import { basename } from 'node:path';
import {
  type BaseWindow,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
} from 'electron';
import { CHANNELS, type RecentProject } from '../shared/ipc.js';

/**
 * Electron types a menu item's `click` window param as `BaseWindow` (the
 * superclass), but every cockpit window is a `BrowserWindow`. Narrow it so the
 * window-keyed handlers keep their `BrowserWindow` contract; a non-BrowserWindow
 * (or absent) focus resolves to `undefined`, which the handlers already treat
 * as "no target".
 */
function asBrowserWindow(win: BaseWindow | undefined): BrowserWindow | undefined {
  return win instanceof BrowserWindow ? win : undefined;
}

/** Click handlers the application menu routes back into the main process. */
export type MenuHandlers = {
  /** File ▸ Open Project… — prompt a folder dialog. */
  onOpen: (win: BrowserWindow | undefined) => void;
  /** File ▸ Open Recent ▸ <project> — open a known folder. */
  onOpenRecent: (win: BrowserWindow | undefined, path: string) => void;
  /** File ▸ Open Recent ▸ Clear Recently Opened. */
  onClearRecents: () => void;
};

function recentSubmenu(
  recents: RecentProject[],
  handlers: MenuHandlers,
): MenuItemConstructorOptions[] {
  if (recents.length === 0) {
    return [{ label: 'No Recent Projects', enabled: false }];
  }
  return [
    ...recents.map(
      (r): MenuItemConstructorOptions => ({
        label: basename(r.path),
        sublabel: r.path,
        click: (_item, win) => handlers.onOpenRecent(asBrowserWindow(win), r.path),
      }),
    ),
    { type: 'separator' },
    { label: 'Clear Recently Opened', click: () => handlers.onClearRecents() },
  ];
}

/**
 * The View submenu, hand-built rather than `{ role: 'viewMenu' }`. The stock
 * role ships Reload (Cmd+R) and Force Reload (Cmd+Shift+R), whose accelerators
 * reload the window's top-level webContents — the whole app shell. The cockpit
 * holds its layout (panes, tabs, terminals) only in renderer memory, so a shell
 * reload silently wipes the user's workspace. Those two items are dropped; the
 * rest of the role's items (devtools, zoom, fullscreen) are harmless and kept.
 */
const viewSubmenu: MenuItemConstructorOptions[] = [
  { role: 'toggleDevTools' },
  { type: 'separator' },
  { role: 'resetZoom' },
  { role: 'zoomIn' },
  { role: 'zoomOut' },
  { type: 'separator' },
  { role: 'togglefullscreen' },
];

/** Send a push IPC to the focused window — null-safe wrapper for the menu
 *  click handlers, which may receive `undefined` for `win` in tests. */
function pushToFocused(win: BrowserWindow | undefined, channel: string, ...args: unknown[]): void {
  const target = win ?? BrowserWindow.getFocusedWindow();
  if (target) target.webContents.send(channel, ...args);
}

/**
 * The Navigate submenu carries the cockpit's keyboard accelerators —
 * ⌘+F to focus the global file search, ⌘+1…⌘+9 to switch to the Nth tab
 * in the left panel. Items are hidden so they do not clutter the menu bar;
 * accelerators still fire. Hidden items work in stock Electron menus —
 * `visible: false` removes the row but keeps the accelerator wired.
 */
const navigateSubmenu: MenuItemConstructorOptions[] = [
  {
    label: 'Find in Project…',
    accelerator: 'CmdOrCtrl+F',
    visible: false,
    click: (_item, win) => pushToFocused(asBrowserWindow(win), CHANNELS.onFocusGlobalSearch),
  },
  ...Array.from({ length: 9 }, (_, i) => i + 1).map(
    (n): MenuItemConstructorOptions => ({
      label: `Go to Tab ${n}`,
      accelerator: `CmdOrCtrl+${n}`,
      visible: false,
      click: (_item, win) => pushToFocused(asBrowserWindow(win), CHANNELS.onSelectCockpitTab, n),
    }),
  ),
];

/**
 * The macOS App menu, hand-built rather than `{ role: 'appMenu' }`. The stock
 * role gives the standard items (About, Services, Hide/Show, Quit) but no way
 * to slot a custom Settings… item with `⌘,`. Hand-building keeps every stock
 * item present in its conventional position and inserts Settings… between
 * About and Services per macOS convention. The Settings click sends a
 * `settings:open` push IPC to the focused window's `webContents`.
 */
const appSubmenu: MenuItemConstructorOptions[] = [
  { role: 'about' },
  { type: 'separator' },
  {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: (_item, win) => {
      // `win` is the focused window when the user fires `⌘,`. Programmatic
      // `item.click()` (used by the e2e) does not pass `win`, so fall back to
      // `getFocusedWindow()`. No-op when nothing is focused.
      const target = asBrowserWindow(win) ?? BrowserWindow.getFocusedWindow();
      if (target) target.webContents.send(CHANNELS.onSettingsOpen);
    },
  },
  { type: 'separator' },
  { role: 'services' },
  { type: 'separator' },
  { role: 'hide' },
  { role: 'hideOthers' },
  { role: 'unhide' },
  { type: 'separator' },
  { role: 'quit' },
];

/**
 * Build the application menu. The File menu carries Open Project… and the
 * Open Recent list; the rest are standard roles so editing, view, and window
 * controls keep working. Rebuilt whenever the recents list changes.
 */
export function buildAppMenu(recents: RecentProject[], handlers: MenuHandlers): Menu {
  const template: MenuItemConstructorOptions[] = [
    { label: app.name, submenu: appSubmenu },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, win) => handlers.onOpen(asBrowserWindow(win)),
        },
        { label: 'Open Recent', submenu: recentSubmenu(recents, handlers) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { label: 'Navigate', submenu: navigateSubmenu, visible: false },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
