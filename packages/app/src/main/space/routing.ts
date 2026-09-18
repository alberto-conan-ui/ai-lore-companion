/**
 * Routing by detection: which window a folder opens in.
 *
 * Detection routing is behind a switch (architecture document, section 2.4 and
 * Finding 6). With `AI_LORE_SPACE_ROUTING=1` a folder goes through
 * `detectFolder` and opens in a 1.0 window. Without it the verdict is
 * `v08-routing`: `main/index.ts` opens the folder as it does today, with
 * `checkProjectCompatibility`, and detection is not run at all. The existing
 * end-to-end suite and the versioning contract's altered window depend on
 * that.
 *
 * This file imports nothing from Electron, so it is tested without it.
 */

import { basename } from 'node:path';
import { type DetectDeps, type FolderKind, detectFolder, spaceKey } from '@ai-lore-companion/core';
import type {
  LegacySummary,
  SpaceSummary,
  SpaceWindowFailure,
  SpaceWindowInitPayload,
} from '../../shared/ipc.js';

/** The environment variable that turns detection routing on. Read once when the app starts. */
export const SPACE_ROUTING_ENV = 'AI_LORE_SPACE_ROUTING';

/** Whether detection routing is on: the variable is exactly `1`. */
export function isSpaceRoutingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env[SPACE_ROUTING_ENV] === '1';
}

/** The window-init payload of a window that shows a folder. */
export type FolderWindowInit = Extract<
  SpaceWindowInitPayload,
  { mode: 'space' | 'migration' | 'not-a-space' }
>;

/** Where a folder goes. */
export type FolderRoute =
  /** Detection routing is off: open the folder as the app does today. Detection was not run. */
  | { route: 'v08-routing'; root: string }
  /** Detection routing is on: open a 1.0 window with this payload. */
  | { route: 'space-window'; root: string; detected: FolderKind; init: FolderWindowInit }
  /** Detection gave no verdict: the path is not a folder, or the folder cannot be listed. */
  | { route: 'failed'; root: string; error: SpaceWindowFailure };

/** What `routeFolder` needs. */
export type RouteDeps = DetectDeps & {
  /** Whether detection routing is on; `isSpaceRoutingOn()` at the start of the app. */
  spaceRouting: boolean;
  /** Replaces `detectFolder` in a test that checks detection is not run. */
  detect?: typeof detectFolder;
};

/** What a window holds about the Space that detection recognised. */
export function spaceSummaryOf(detected: Extract<FolderKind, { kind: 'space' }>): SpaceSummary {
  return {
    root: detected.root,
    key: spaceKey(detected.root),
    name: detected.manifest.name,
    manifest: detected.manifest,
  };
}

/** What the migration screen is told about the legacy project that detection recognised. */
export function legacySummaryOf(detected: Extract<FolderKind, { kind: 'legacy' }>): LegacySummary {
  return {
    projectName: detected.projectName,
    lorePath: detected.lorePath,
    coreVersion: detected.coreVersion,
    manifestLocation: detected.manifestLocation,
    migratable: detected.migratable,
    versionStanding: detected.versionStanding,
    reason: detected.reason,
  };
}

/**
 * The window of each detected kind (the table of section 2.4): a Space opens
 * the Space window; an AI-Lore project of v0.8 or older opens the migration
 * screen, which shows "upgrade to v0.8 first" when `legacy.migratable` is
 * false; a plain repository and anything else open the not-a-Space screen,
 * the first with the offer to create a Space about it.
 */
export function windowInitFor(detected: FolderKind): FolderWindowInit {
  switch (detected.kind) {
    case 'space':
      return { mode: 'space', space: spaceSummaryOf(detected) };
    case 'legacy':
      return { mode: 'migration', folder: detected.root, legacy: legacySummaryOf(detected) };
    case 'plain-repository':
      return {
        mode: 'not-a-space',
        folder: detected.root,
        plainRepository: true,
        reason: detected.reason,
      };
    case 'other':
      return {
        mode: 'not-a-space',
        folder: detected.root,
        plainRepository: false,
        reason: detected.reason,
      };
  }
}

/** The title of the window that shows `init`: the Space's name, or the folder's name. */
export function windowTitleFor(init: FolderWindowInit): string {
  if (init.mode !== 'space') return basename(init.folder);
  return init.space.name === '' ? basename(init.space.root) : init.space.name;
}

/** Decide where `root` goes. It reads the folder and writes nothing. */
export async function routeFolder(root: string, deps: RouteDeps): Promise<FolderRoute> {
  if (!deps.spaceRouting) return { route: 'v08-routing', root };
  const detected = await (deps.detect ?? detectFolder)(root, { git: deps.git });
  if (!detected.ok) return { route: 'failed', root, error: detected.error };
  return {
    route: 'space-window',
    root: detected.value.root,
    detected: detected.value,
    init: windowInitFor(detected.value),
  };
}
