import { basename } from 'node:path';
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app } from 'electron';
import { IPC, type RecentProject } from '../shared/ipc.js';

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
        click: (_item, win) => handlers.onOpenRecent(win, r.path),
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
      const target = win ?? BrowserWindow.getFocusedWindow();
      if (target) target.webContents.send(IPC.SettingsOpen);
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
          click: (_item, win) => handlers.onOpen(win),
        },
        { label: 'Open Recent', submenu: recentSubmenu(recents, handlers) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
