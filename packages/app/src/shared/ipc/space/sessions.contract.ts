/**
 * The channels of sessions (phase M4.4; M4.6 extends it). The handlers are in
 * `main/space/ipc/sessions.ts` and the types in `./sessions.types.ts`. This
 * fragment is spread into `CONTRACT`.
 */

import { invoke, push } from './describe.js';
import type {
  SpaceSessionEndArg,
  SpaceSessionEndResult,
  SpaceSessionEngineArg,
  SpaceSessionHeader,
  SpaceSessionHeaderResult,
  SpaceSessionLeaveWritingResult,
  SpaceSessionReadinessResult,
  SpaceSessionStartResult,
  SpaceSkillsArg,
  SpaceSkillsResult,
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
  /** The header of a session as the desk records it now: mode, claimed targets, item (M4.6). */
  spaceSessionHeader: invoke<[arg: SpaceSessionEndArg], SpaceSessionHeaderResult>(
    'space:session-header',
  ),
  /**
   * The header's Leave Writing: the session returns to Read only and its
   * claims are released, the same step as the tool `leave_writing` (M4.6).
   */
  spaceSessionLeaveWriting: invoke<[arg: SpaceSessionEndArg], SpaceSessionLeaveWritingResult>(
    'space:session-leave-writing',
  ),
  /** A session's header changed on the desk: it entered or left Writing (M4.6). */
  onSpaceSessionHeader: push<SpaceSessionHeader>('space:on-session-header'),
  /** The skills of the Space's install, read with the Lore reader (M4.6). */
  spaceSkillsList: invoke<[arg: SpaceSkillsArg], SpaceSkillsResult>('space:skills-list'),
} as const;
