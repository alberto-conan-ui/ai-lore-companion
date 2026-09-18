/**
 * Argument, result and payload types of the channels of sessions (phase
 * M4.4; M4.6 adds the header and the skills). Plain data only; types from core
 * are imported with `import type`. `shared/ipc.ts` already re-exports this file.
 */

import type { IssueRef, LoreLayer, SessionMode, WriteTarget } from '@ai-lore-companion/core';

/** Argument of `spaceSessionStart` and `spaceSessionReadiness`: an engine id of the registry. */
export type SpaceSessionEngineArg = { engineId: string };

/** Argument of `spaceSessionEnd`. */
export type SpaceSessionEndArg = { sessionId: string };

/** Why a session was not started, or cannot be. `message` can be shown to the Human Lead as it is. */
export type SpaceSessionFailure = {
  kind:
    | 'invalid-argument'
    | 'not-a-space-window'
    | 'no-terminal'
    | 'engine-not-found'
    | 'engine-not-supported'
    | 'python3-missing'
    | 'not-installed'
    | 'install-record-unreadable'
    | 'install-record-newer'
    | 'plugin-missing'
    | 'check-missing'
    | 'check-altered'
    | 'desk-unavailable'
    | 'session-server-unavailable'
    | 'session-files-failed'
    | 'start-failed'
    | 'unknown-session'
    | 'leave-failed'
    | 'lore-unreadable';
  message: string;
};

/**
 * A started session. `ptyId` is a terminal of the window's terminal service:
 * the existing terminal channels write to it, resize it and receive its exit.
 */
export type SpaceSessionStarted = { sessionId: string; ptyId: string; engineId: string };

export type SpaceSessionStartResult =
  | { ok: true; value: SpaceSessionStarted }
  | { ok: false; error: SpaceSessionFailure };

/** Whether a session can start now. A failure's `message` is the sentence for `aiUnavailableReason`. */
export type SpaceSessionReadinessResult =
  | { ok: true; value: { engineId: string } }
  | { ok: false; error: SpaceSessionFailure };

export type SpaceSessionEndResult =
  | { ok: true; value: { sessionId: string } }
  | { ok: false; error: SpaceSessionFailure };

/**
 * What the header of an AI tab shows for its session, read from the desk
 * (phase M4.6). `targets` are the session's claims now: empty in Read only.
 * `item` is the item the session is on, or `null`.
 */
export type SpaceSessionHeader = {
  sessionId: string;
  engineId: string;
  mode: SessionMode;
  targets: WriteTarget[];
  item: IssueRef | null;
  /** True once the desk records the session's end. */
  closed: boolean;
};

export type SpaceSessionHeaderResult =
  | { ok: true; value: SpaceSessionHeader }
  | { ok: false; error: SpaceSessionFailure };

/** What leaving Writing released. `released` is empty when the session held no target. */
export type SpaceSessionLeftWriting = { sessionId: string; released: WriteTarget[] };

export type SpaceSessionLeaveWritingResult =
  | { ok: true; value: SpaceSessionLeftWriting }
  | { ok: false; error: SpaceSessionFailure };

/**
 * One skill of the Space's install into Claude Code: a verb or a process of
 * the Lore in use, which Claude Code shows as `/lore:<name>`. `description` is
 * the sentence of the card's index line.
 */
export type SpaceSkill = {
  name: string;
  part: 'verbs' | 'processes';
  layer: LoreLayer;
  description: string | null;
};

/**
 * The skills of the Space, sorted by name within each part. `notInstalled`
 * names the verbs and processes of the Lore that have no installed skill.
 */
export type SpaceSkillsList = { skills: SpaceSkill[]; notInstalled: string[] };

/** Argument of `spaceSkillsList`: an empty object. */
export type SpaceSkillsArg = Record<string, never>;

export type SpaceSkillsResult =
  | { ok: true; value: SpaceSkillsList }
  | { ok: false; error: SpaceSessionFailure };
