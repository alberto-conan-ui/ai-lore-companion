/**
 * The Spaces folder setting (phase M9.4, architecture document A.5).
 *
 * The registry setting `spaces.folder` (core's `SETTINGS_REGISTRY`) holds an
 * absolute folder path, or the empty string for "not set". It is written only
 * from here, from a click on Set up this computer (`space:spaces-folder-use`,
 * `space:spaces-folder-choose`) — never from a path the renderer sends on its
 * own.
 *
 * The first value shown is only proposed, never written: `proposeSpacesFolder`
 * gives the parent folder of the newest recent Space when there is one,
 * otherwise `<home>/Spaces`. The Human Lead confirms it (Use this folder) or
 * picks another (Choose…) before it is saved.
 */

import { mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  type Failure,
  type Result,
  SETTINGS_REGISTRY,
  fail,
  ok,
  resolveSetting,
} from '@ai-lore-companion/core';
import type { RecentSpace } from '../../shared/ipc.js';
import { loadGlobalSettings, saveGlobalSetting } from '../settings.js';

/** The key of the setting in `settings.json`, both tiers considered global. */
export const SPACES_FOLDER_KEY = 'spaces.folder';

function settingDef() {
  return SETTINGS_REGISTRY.find((def) => def.key === SPACES_FOLDER_KEY) ?? null;
}

/** Whether `folder` is an absolute path of a folder that exists. */
function isExistingFolder(folder: string): boolean {
  if (!isAbsolute(folder)) return false;
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The setting's value when it is an absolute path of an existing folder;
 * `null` otherwise (not set, or the folder is gone).
 */
export function readSpacesFolder(userDataDir: string): string | null {
  const def = settingDef();
  if (def === null) return null;
  const value = resolveSetting(def, loadGlobalSettings(userDataDir), null);
  if (typeof value !== 'string' || value.length === 0) return null;
  return isExistingFolder(value) ? value : null;
}

/**
 * The folder to propose on Set up this computer: the parent folder of the
 * newest recent Space (`recents`, newest first), otherwise `<home>/Spaces`.
 */
export function proposeSpacesFolder(recents: readonly RecentSpace[], home: string): string {
  const newest = recents[0];
  return newest !== undefined ? dirname(newest.path) : join(home, 'Spaces');
}

/**
 * Create `folder` (recursive) and save it as the `spaces.folder` setting.
 * Refuses a path that is not absolute; a path that exists and is not a
 * folder is refused too.
 */
export function useSpacesFolder(
  userDataDir: string,
  folder: string,
): Result<string, Failure<'invalid-argument' | 'not-a-folder' | 'failed'>> {
  if (!isAbsolute(folder)) {
    return fail('invalid-argument', 'The Spaces folder must be an absolute path.');
  }
  try {
    mkdirSync(folder, { recursive: true });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return fail('failed', `The folder ${folder} could not be created: ${message}`);
  }
  if (!isExistingFolder(folder)) {
    return fail('not-a-folder', `${folder} is not a folder.`);
  }
  saveGlobalSetting(userDataDir, SPACES_FOLDER_KEY, folder);
  return ok(folder);
}
