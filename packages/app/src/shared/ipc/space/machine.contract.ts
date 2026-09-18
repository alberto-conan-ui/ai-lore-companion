/**
 * The channels of the machine check (phase M3.6). The handlers are in
 * `main/space/ipc/machine.ts` and the types in `./machine.types.ts`. This
 * fragment is spread into `CONTRACT`.
 */

import { invoke } from './describe.js';
import type { SpaceMachineCheckArg, SpaceMachineCheckResult } from './machine.types.js';

export const SPACE_MACHINE_CONTRACT = {
  /**
   * Check the machine: `git`, `gh`, an engine of the registry and `python3`.
   * "Check again" is this channel with `fresh: true`. The check only reads; it
   * installs nothing and signs in nowhere.
   */
  spaceMachineCheck: invoke<[arg: SpaceMachineCheckArg], SpaceMachineCheckResult>(
    'space:machine-check',
  ),
} as const;
