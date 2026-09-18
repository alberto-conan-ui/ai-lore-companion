/**
 * Where the repository under test is. Core's tests run from `dist-test/test/`,
 * so the repository root is found by walking up from this file to the
 * `package.json` that declares the workspaces. Tests read files of the
 * repository (the Lore template) and never write them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root folder of the repository under test. */
export function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('the repository root was not found above the tests');
    dir = parent;
  }
}

/** `packages/spec/lore-1.0`, the template a new Space starts from. Read only. */
export function loreTemplateDir(): string {
  return join(repositoryRoot(), 'packages', 'spec', 'lore-1.0');
}
