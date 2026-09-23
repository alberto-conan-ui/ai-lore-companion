/**
 * Argument, result and payload types of the channels of sessions (phase
 * M4.4; M4.6 adds the header and the skills). Plain data only; types from core
 * are imported with `import type`. `shared/ipc.ts` already re-exports this file.
 */

import type { IssueRef, LoreLayer, SessionMode, WriteTarget } from '@ai-lore-companion/core';

/** Argument of `spaceSessionReadiness`: an engine id of the registry. */
export type SpaceSessionEngineArg = { engineId: string };

/**
 * One line of the Lore readiness report (M10.5, `m10-architecture.md` 3.6):
 * whether the engine has one aspect of what a Claude Code session has.
 * `yes`: as a Claude Code session has it. `partly`: some of it, `text` says
 * what. `no`: none.
 */
export type SpaceLoreLine = {
  aspect: 'lore' | 'session-tools' | 'guard';
  state: 'yes' | 'partly' | 'no';
  text: string;
};

/** The Lore readiness report of one engine option. `lines` is always three, in the order lore, session-tools, guard. */
export type SpaceEngineLore = {
  lines: SpaceLoreLine[];
  asClaudeCode: boolean;
  /** The session starts without Read only: the Space has an AGENTS.md and the engine supports it (ai-lore#144). */
  standardLore?: boolean;
};

/**
 * Argument of `spaceSessionStart` (M10.3): the engine id, and the ticked
 * parameters' texts. Every text must be a parameter of that engine now.
 */
export type SpaceSessionStartArg = { engineId: string; params: string[] };

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
    | 'engine-not-installed'
    | 'engine-not-signed-in'
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
    | 'lore-unreadable'
    | 'reinstall-failed';
  message: string;
};

/**
 * A started session. `ptyId` is a terminal of the window's terminal service:
 * the existing terminal channels write to it, resize it and receive its exit.
 * `unguarded` names the guard-changing options this start's parameters held;
 * empty when the session is guarded.
 */
export type SpaceSessionStarted = {
  sessionId: string;
  ptyId: string;
  engineId: string;
  unguarded: string[];
};

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
  /** The guard-changing options this session started with, by name; empty when guarded. */
  unguarded: string[];
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
 * One skill of the Space's install: a verb or a process of the Lore in use.
 * `description` is the sentence of the card's index line, as installed.
 * `invocation` is the text the Skills column types for it (M10.5): `/lore:<name>`
 * for Claude Code, and each other engine's own form; `/lore:<name>` when the
 * call named no engine or an engine with no adapter.
 */
export type SpaceSkill = {
  name: string;
  part: 'verbs' | 'processes';
  layer: LoreLayer;
  description: string | null;
  invocation: string;
};

/**
 * The skills of the Space, sorted by name within each part. `notInstalled`
 * names the verbs and processes of the Lore that have no installed skill.
 */
export type SpaceSkillsList = { skills: SpaceSkill[]; notInstalled: string[] };

/** Argument of `spaceSkillsList`: the engine the invocations are for, or none (M10.5). */
export type SpaceSkillsArg = { engineId?: string };

export type SpaceSkillsResult =
  | { ok: true; value: SpaceSkillsList }
  | { ok: false; error: SpaceSessionFailure };

/**
 * The engine of a Space session is chosen by readiness, not by the order of
 * `engines.json` (phase M9.7, finding 8: a new Space picked Gemini and could
 * not start a session). The fix a refusal offers.
 */
export type SpaceEngineFixKind =
  | 'set-up-claude-code'
  | 'sign-in'
  | 'set-up-python3'
  | 'reinstall-lore'
  | 'edit-engine'
  | 'install-engine';

export type SpaceEngineFix = {
  kind: SpaceEngineFixKind;
  /** The button's text. */
  label: string;
  /** For `sign-in`. */
  commandId: string | null;
  /** Shown beside the button, for `sign-in`. */
  commandLine: string | null;
  /** Set up this computer opens at this section. */
  section: 'tools' | 'engines' | null;
};

/**
 * One parameter of an engine, as the start control shows it (M10.3).
 * `effect`: `none` changes nothing; `unguarded` starts an unguarded session;
 * `refused` is set by the companion and cannot be ticked. `options` are the
 * reserved or guard-changing option names the parameter's argument list holds.
 */
export type SpaceEngineParam = {
  text: string;
  defaultOn: boolean;
  effect: 'none' | 'unguarded' | 'refused';
  options: string[];
};

/** One engine of the list `spaceSessionEngines` answers with. */
export type SpaceEngineOption = {
  engineId: string;
  name: string;
  canStart: boolean;
  /** `null` when `canStart`. */
  reason: string | null;
  fix: SpaceEngineFix | null;
  /** The engine's parameters, each with its effect (M10.3). */
  params: SpaceEngineParam[];
  /** The Lore readiness report of this engine (M10.5). */
  lore: SpaceEngineLore;
};

/** The engine choice of A.9: every engine of the list, and which one a session starts with. */
export type SpaceEngineChoice = {
  /** Every engine of the list, in list order (catalog first). */
  options: SpaceEngineOption[];
  /** The engine the start control uses; `null` when none can start. */
  engineId: string | null;
  /** The name on the button: the chosen engine's, else the first guarded catalog engine's. */
  buttonName: string;
  /** Set when `engineId` is `null`. */
  refusal: { message: string; fix: SpaceEngineFix | null } | null;
};

/** Argument of `spaceSessionEnginePick`. */
export type SpaceSessionEnginePickArg = { engineId: string };

export type SpaceSessionEnginesResult =
  | { ok: true; value: SpaceEngineChoice }
  | { ok: false; error: SpaceSessionFailure };
