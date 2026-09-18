/**
 * The channels of sessions (phase M4.4; M4.6 extends it). The handlers are in
 * `main/space/ipc/sessions.ts` and the types in `./sessions.types.ts`. This
 * fragment is spread into `CONTRACT`.
 */

import { invoke } from './describe.js';
import type {
  SpaceSessionEndArg,
  SpaceSessionEndResult,
  SpaceSessionEngineArg,
  SpaceSessionReadinessResult,
  SpaceSessionStartResult,
} from './sessions.types.js';

export const SPACE_SESSIONS_CONTRACT = {
  /**
   * Whether a guarded session can start with the engine: Claude Code, `python3`,
   * and the Space's install with every check script as installed. Starts nothing.
   */
  spaceSessionReadiness: invoke<[arg: SpaceSessionEngineArg], SpaceSessionReadinessResult>(
    'space:session-readiness',
  ),
  /**
   * Start a guarded AI session in the Space: Read only, the write-guard hook,
   * the Space's Lore as a plugin, the session server. The engine runs in a
   * terminal of the window, in the Space's folder.
   */
  spaceSessionStart: invoke<[arg: SpaceSessionEngineArg], SpaceSessionStartResult>(
    'space:session-start',
  ),
  /** End a session of the Space: its engine is stopped and its end is recorded. */
  spaceSessionEnd: invoke<[arg: SpaceSessionEndArg], SpaceSessionEndResult>('space:session-end'),
} as const;
