import { join } from 'node:path';
import { z } from 'zod';
import { BROWSER_PROFILES, type BrowserProfile } from '../shared/ipc.js';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';

/**
 * The browser companion's chosen profile, persisted as a small JSON file under
 * `app.getPath('userData')` so the choice survives restarts. Profile-scoped
 * browsing data itself lives in Electron's `persist:` partitions, not here.
 */

const prefsSchema = z.object({ profile: z.enum(BROWSER_PROFILES) });

function prefsFile(userDataDir: string): string {
  return join(userDataDir, 'browser.json');
}

/** The saved profile, or the first profile when nothing is stored yet. */
export function loadBrowserProfile(userDataDir: string): BrowserProfile {
  const parsed = prefsSchema.safeParse(readJsonFile(prefsFile(userDataDir)));
  return parsed.success ? parsed.data.profile : BROWSER_PROFILES[0];
}

/** Persist the chosen browser profile. */
export function saveBrowserProfile(userDataDir: string, profile: BrowserProfile): void {
  writeJsonFileAtomic(prefsFile(userDataDir), { profile }, { pretty: true });
}
