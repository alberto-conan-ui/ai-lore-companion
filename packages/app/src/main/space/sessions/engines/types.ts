/**
 * The engine adapter interface (phase M10.5, `m10-architecture.md` 3.2): what
 * turns the pieces main already prepares for a session (the verified install,
 * `python3`, the session server connection, the session folder) into what one
 * engine needs to launch: its argument list, its environment, and the files
 * written into the session's folder.
 *
 * The session service (`service.ts`) keeps every other step of section 5.6 of
 * `mvp-architecture.md`: the record on the desk, the registration on the
 * session server, the spawn in the PTY, the end.
 */

import type { EngineCatalogId } from '@ai-lore-companion/core';
import type { SessionConnection } from '../../session-server/index.js';
import type { EngineOptions } from '../engine-options.js';
import type { SessionFilePaths } from '../files.js';
import type { VerifiedInstall } from '../preflight.js';
import type { InstalledSkill } from './skills.js';

/** One aspect of the Lore readiness report (ruling 4 of section 1). */
export type LoreAspect = 'lore' | 'session-tools' | 'guard';

/** `yes`: as a Claude Code session has it. `partly`: some of it, the text says what. `no`: none. */
export type LoreState = 'yes' | 'partly' | 'no';

export type LoreLine = { aspect: LoreAspect; state: LoreState; text: string };

/** What an adapter can give a session, before any live check (3.6). */
export type LoreCapability = { lore: LoreLine; sessionTools: LoreLine; guard: LoreLine };

/** Everything an adapter needs to launch one session. Every path is absolute. */
export type SessionLaunchInput = {
  sessionId: string;
  spaceRoot: string;
  deskDir: string;
  /** The session's folder and its fixed files (`files.ts`). */
  paths: SessionFilePaths;
  python: string;
  install: VerifiedInstall;
  skills: readonly InstalledSkill[];
  connection: SessionConnection;
  /** The names of the Space's repositories, from its manifest. */
  repositories: readonly string[];
  /** The session instructions of section 3.3, already rendered for this engine. */
  instructions: string;
  /** The argument list of the ticked parameters, in the order of the engine's parameters. */
  paramArgv: readonly string[];
};

/** A file an adapter writes, relative to the session's folder, with `/`. Mode 0600; folders 0700. */
export type LaunchFile = { path: string; content: string };

export type SessionLaunch = {
  /** The engine's arguments after its binary. The parameters come first. */
  args: string[];
  /** Added to the process environment, beside `AI_LORE_SESSION_ID`. */
  env: Record<string, string>;
  files: LaunchFile[];
};

export type EngineAdapter = {
  catalogId: EngineCatalogId;
  capability: LoreCapability;
  /** The engine's own reserved and guard-changing options (3.5). */
  options: EngineOptions;
  /** The text the Skills column types for a verb or process `name`, without a newline. */
  skillInvocation(name: string): string;
  /** `invoked`: the verbs are skills or commands the session can run. `listed`: the instructions list them with their card paths (3.3). */
  verbsAre: 'invoked' | 'listed';
  launch(input: SessionLaunchInput): SessionLaunch;
};
