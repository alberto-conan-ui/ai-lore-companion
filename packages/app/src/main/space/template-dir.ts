/**
 * Where the Lore template of 1.0 is: the folder setup scaffolds a Space from
 * (architecture document, section 5.8). Core receives the folder as a
 * parameter; this file decides which folder it is.
 *
 * - In a packaged app it is `<resources>/lore-1.0`, where `<resources>` is
 *   Electron's `process.resourcesPath`. `build.extraResources` in the app's
 *   `package.json` copies `packages/spec/lore-1.0` there, every file as it is,
 *   the Python scripts of the template included.
 * - In development, and in the headless and end-to-end tests, it is
 *   `packages/spec/lore-1.0`, found by going up from where this code runs
 *   (`packages/app/out/main` in the built app, the test output folder in a
 *   headless test) to the folder that holds `spec/lore-1.0`.
 *
 * A packaged app is told apart without importing Electron, so a headless test
 * runs this file as it is: Electron sets `process.defaultApp` when it is
 * started as `electron <main script>` (development and the end-to-end tests),
 * and leaves it unset in a packaged app. A packaged app never falls back to a
 * workspace copy: if its own copy is missing, setup stops and says where it
 * looked.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Result } from '@ai-lore-companion/core';

/** The template's folder name, under `packages/spec` and under the packaged app's resources. */
export const TEMPLATE_FOLDER = 'lore-1.0';

/** The folder a template must hold to be taken as one. */
const TEMPLATE_MARKER = 'lore';

/** What `loreTemplateDir` looks at. A test gives each; the app gives none. */
export type TemplateDirOptions = {
  /** Whether this is a packaged app. Default: `isPackagedApp()`. */
  packaged?: boolean;
  /** The packaged app's resources folder. Default: `process.resourcesPath`. */
  resourcesPath?: string;
  /** Where the search for the workspace copy starts. Default: the folder of this code. */
  from?: string;
};

/** Whether this process is a packaged Electron app (see this file's header). */
export function isPackagedApp(proc: NodeJS.Process = process): boolean {
  return (
    proc.versions.electron !== undefined &&
    proc.defaultApp !== true &&
    typeof proc.resourcesPath === 'string'
  );
}

function isTemplate(folder: string): boolean {
  return existsSync(join(folder, TEMPLATE_MARKER));
}

/**
 * The Lore template: the packaged copy in a packaged app, the workspace copy
 * otherwise. Fails with `template-missing` and a sentence that names where it
 * looked.
 */
export function loreTemplateDir(options: TemplateDirOptions = {}): Result<string> {
  const packaged = options.packaged ?? isPackagedApp();
  if (packaged) {
    const resources = options.resourcesPath ?? process.resourcesPath;
    const candidate = resources === undefined ? null : join(resources, TEMPLATE_FOLDER);
    if (candidate !== null && isTemplate(candidate)) return { ok: true, value: candidate };
    return {
      ok: false,
      error: {
        kind: 'template-missing',
        message: `The Lore template was not found: this installed app has no folder ${candidate ?? TEMPLATE_FOLDER} among its resources. A Space is made from that template, so setup cannot run. Install the app again.`,
      },
    };
  }
  const from = options.from ?? dirname(fileURLToPath(import.meta.url));
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, 'spec', TEMPLATE_FOLDER);
    if (isTemplate(candidate)) return { ok: true, value: candidate };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    ok: false,
    error: {
      kind: 'template-missing',
      message: `The Lore template was not found: no folder above ${from} holds spec/${TEMPLATE_FOLDER}. A Space is made from that template, so setup cannot run.`,
    },
  };
}
