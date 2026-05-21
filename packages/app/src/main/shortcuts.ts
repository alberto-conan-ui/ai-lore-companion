import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Shortcut } from '../shared/ipc.js';

/**
 * App-launch shortcuts — a user-configured list, persisted as a JSON file
 * under `app.getPath('userData')`. The list is global: the same shortcuts are
 * offered in every project window, and each resolves its target folder
 * (project root or Lore) against the window it is fired from.
 */

function shortcutsFile(userDataDir: string): string {
  return join(userDataDir, 'shortcuts.json');
}

function isShortcut(x: unknown): x is Shortcut {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    (s.target === 'project' || s.target === 'lore' || s.target === 'url') &&
    (s.app === undefined || typeof s.app === 'string') &&
    (s.url === undefined || typeof s.url === 'string')
  );
}

/** Read the shortcut list — an empty list when the file is absent or corrupt. */
export function loadShortcuts(userDataDir: string): Shortcut[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(shortcutsFile(userDataDir), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isShortcut) : [];
  } catch {
    return [];
  }
}

/** Persist the shortcut list. */
export function saveShortcuts(userDataDir: string, list: Shortcut[]): void {
  const file = shortcutsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list, null, 2));
}

/**
 * Launch a macOS application on a folder. Uses `open -a` — the only way to
 * target a *specific* app; Electron's `shell.openPath` opens the default
 * handler. macOS-specific by design (see the Phase D out-of-scope).
 */
export function launchApp(app: string, folder: string): void {
  execFile('open', ['-a', app, folder], (err) => {
    if (err) console.error(`shortcut launch failed (${app}): ${err.message}`);
  });
}

/** Open a URL in a Chrome window. */
export function launchUrl(url: string): void {
  execFile('open', ['-a', 'Google Chrome', url], (err) => {
    if (err) console.error(`shortcut URL launch failed: ${err.message}`);
  });
}
