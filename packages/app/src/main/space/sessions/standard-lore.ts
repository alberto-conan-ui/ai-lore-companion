/**
 * A Space whose Lore is standard files (ai-lore#144, the agreed spec
 * `publish/specs/f1-agents-work-without-permission.md`, D-1.3 and D-1.5).
 *
 * The spec removes the modes Read only and Writing, the write targets and the
 * write-guard: work is kept safe by the engine's own settings, by a branch per
 * piece of work, and by GitHub. A Space says it has made that move by having an
 * `AGENTS.md` at the top of its folder. For a session of such a Space, an adapter
 * that supports it (`EngineAdapter.supportsStandardLore`) adds no write hooks
 * and no `lore` plugin, and lets the Space's and the Human Lead's own engine
 * settings apply. A PM session stays guarded: its role is Read only by design.
 */

import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

/** The file whose presence at the top of a Space's folder marks its Lore as standard files. */
export const STANDARD_LORE_ENTRY = 'AGENTS.md';

/** Whether the Space at `spaceRoot` has an `AGENTS.md` that is a regular file (a link does not count). */
export async function hasStandardLore(spaceRoot: string): Promise<boolean> {
  try {
    return (await lstat(join(spaceRoot, STANDARD_LORE_ENTRY))).isFile();
  } catch {
    return false;
  }
}
