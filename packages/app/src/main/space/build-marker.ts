/**
 * Routing's second input: is this the 1.0 ("Space") build?
 *
 * `packages/app/electron-builder.space.json` (M11.1) packages a second
 * application from the same source tree, with its own `appId` and product
 * name. Its `extraMetadata` writes `aiLoreSpaceBuild: true` into that
 * package's own `package.json` — the v0.8 build's `package.json`, produced
 * by the inline configuration in `package.json`'s `build` key, never gets
 * this field. `index.ts` reads it once at startup and combines it with
 * `AI_LORE_SPACE_ROUTING` (`space/routing.ts`): detection routing is on when
 * either input says so, so the Space build routes on detection with no
 * environment variable set (architecture document, section 2.4).
 *
 * `isSpaceBuild` reads the filesystem through `app.getAppPath()`, so — unlike
 * `routing.ts` — this file is not tested without Electron. `hasSpaceBuildMarker`
 * and `spaceRoutingDecision` are plain functions and are.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** The `package.json` field electron-builder's `extraMetadata` sets to mark the Space build. */
export const SPACE_BUILD_FIELD = 'aiLoreSpaceBuild';

/** Whether a parsed `package.json` carries the Space build's marker field. */
export function hasSpaceBuildMarker(pkg: unknown): boolean {
  return (
    typeof pkg === 'object' &&
    pkg !== null &&
    (pkg as Record<string, unknown>)[SPACE_BUILD_FIELD] === true
  );
}

/**
 * Whether the running app is the Space build. Reads the marker from the
 * app's own `package.json`, found via `app.getAppPath()` — in the packaged
 * Space build that is the `package.json` `extraMetadata` wrote the field
 * into; in every other build (v0.8, or this one run unpackaged in dev) the
 * field is absent and this is `false`. A read or parse failure is also
 * `false`: the switch defaults off.
 */
export function isSpaceBuild(): boolean {
  try {
    const raw = readFileSync(join(app.getAppPath(), 'package.json'), 'utf8');
    return hasSpaceBuildMarker(JSON.parse(raw));
  } catch {
    return false;
  }
}

/** Detection routing is on when the environment variable is set or this is the Space build. */
export function spaceRoutingDecision(envRoutingOn: boolean, spaceBuild: boolean): boolean {
  return envRoutingOn || spaceBuild;
}
