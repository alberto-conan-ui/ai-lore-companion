import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BROWSER_PROFILES, type BrowserProfile } from '../shared/ipc.js';

/**
 * The browser companion's chosen profile, persisted as a small JSON file under
 * `app.getPath('userData')` so the choice survives restarts. Profile-scoped
 * browsing data itself lives in Electron's `persist:` partitions, not here.
 */

function prefsFile(userDataDir: string): string {
  return join(userDataDir, 'browser.json');
}

/** The saved profile, or the first profile when nothing is stored yet. */
export function loadBrowserProfile(userDataDir: string): BrowserProfile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(prefsFile(userDataDir), 'utf8'));
    const profile = (parsed as { profile?: unknown }).profile;
    if (typeof profile === 'string' && (BROWSER_PROFILES as readonly string[]).includes(profile)) {
      return profile as BrowserProfile;
    }
  } catch {
    // No prefs file yet, or unreadable — fall through to the default.
  }
  return BROWSER_PROFILES[0];
}

/** Persist the chosen browser profile. */
export function saveBrowserProfile(userDataDir: string, profile: BrowserProfile): void {
  const file = prefsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ profile }, null, 2));
}
