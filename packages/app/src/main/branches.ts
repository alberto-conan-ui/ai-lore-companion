/**
 * The header's branch payload — both repos read in one place so main computes
 * and the renderer only renders (the renderer is types-only against core, so
 * `currentBranch`, a `spawnSync`, must run here). Kept as its own module so the
 * headless suite can exercise the pairing against real temp repos without
 * touching the Electron host.
 */

import { currentBranch } from '@ai-lore-companion/core';
import type { BranchesPayload } from '../shared/ipc.js';

/** Read both repos' current branch. `loreWorkingTree` is `<lorePath>/memory` —
 *  the lore repo's `.git` lives under `memory/`, not at the lore folder root. */
export function readBranches(payloadRoot: string, loreWorkingTree: string): BranchesPayload {
  return {
    payload: currentBranch(payloadRoot),
    lore: currentBranch(loreWorkingTree),
  };
}
