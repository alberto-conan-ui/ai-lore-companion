import { basename } from 'node:path';
import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { RecentProject } from '../shared/ipc.js';

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
 * Build the application menu. The File menu carries Open Project… and the
 * Open Recent list; the rest are standard roles so editing, view, and window
 * controls keep working. Rebuilt whenever the recents list changes.
 */
export function buildAppMenu(recents: RecentProject[], handlers: MenuHandlers): Menu {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
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
