/**
 * The channels of the Plans band: the state as the service holds it, a read on demand, the push of every change of
 * state, and opening a row's dashboard. Argument and result types are `plans.types.ts`.
 */

import { invoke, push } from './describe.js';
import type {
  SpacePlansArg,
  SpacePlansOpenArg,
  SpacePlansOpenResult,
  SpacePlansState,
  SpacePlansStateResult,
} from './plans.types.js';

export const SPACE_PLANS_CONTRACT = {
  /** The state as the service holds it now. It starts no read: the band asks for one with `spacePlansRefresh`. */
  spacePlansState: invoke<[arg: SpacePlansArg], SpacePlansStateResult>('space:plans-state'),
  /** Read now (the band's timer, its Refresh, the window gaining focus). Answers when the run that serves it ended. */
  spacePlansRefresh: invoke<[arg: SpacePlansArg], SpacePlansStateResult>('space:plans-refresh'),
  /** Open the dashboard of a listed unit in the browser, starting `tools/plan/edit.py` first when nothing answers. */
  spacePlansOpen: invoke<[arg: SpacePlansOpenArg], SpacePlansOpenResult>('space:plans-open'),
  /** The plans state changed: a read started or ended. */
  onSpacePlansState: push<SpacePlansState>('space:on-plans-state'),
} as const;
