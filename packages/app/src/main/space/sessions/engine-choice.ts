/**
 * The engine of a Space session (phase M9.7, architecture document A.9):
 * chosen by readiness, not by the order of `engines.json` (finding 8 — a new
 * Space picked Gemini and could not start a session). An engine that cannot
 * run a guarded session at all is never checked; every other engine's
 * readiness (A.10) decides whether it can start, and a refusal carries the
 * fix that clears it.
 */

import {
  type EngineEntry,
  canRunGuardedSession,
  catalogEntryFor,
  setupCommandLine,
  splitParamText,
} from '@ai-lore-companion/core';
import type {
  SpaceEngineChoice,
  SpaceEngineFix,
  SpaceEngineOption,
  SpaceEngineParam,
} from '../../../shared/ipc.js';
import { paramEffect } from './engine-options.js';
import { adapterFor, optionsFor } from './engines/index.js';
import { loreReadiness } from './engines/lore-readiness.js';
import type { SessionStartFailure } from './preflight.js';
import type { SessionReadiness } from './service.js';

const NOT_GUARDED_REASON = 'guarded Space sessions are not available for this engine yet';

/**
 * The `readiness` `loreReadiness` is given for an engine that cannot run a
 * guarded session at all: unused (the `null` adapter decides), so its shape
 * only needs to satisfy the type.
 */
const NOT_GUARDED_READINESS: SessionReadiness = {
  ok: false,
  error: { kind: 'engine-not-supported', message: NOT_GUARDED_REASON },
};

/** The menu's `reason` for a readiness failure (the table of A.9). */
function reasonFor(failure: SessionStartFailure): string {
  switch (failure.kind) {
    case 'engine-not-found':
    case 'engine-not-installed':
      return 'not installed';
    case 'engine-not-signed-in':
      return 'not signed in';
    case 'python3-missing':
      return 'python3 3.8 or later was not found';
    case 'not-installed':
    case 'install-record-unreadable':
    case 'plugin-missing':
    case 'check-missing':
    case 'check-altered':
      return 'the Lore is not installed for it in this Space';
    case 'engine-not-supported':
      return 'its arguments change the permissions of a session';
    default:
      return failure.message;
  }
}

/** The fix of a readiness failure (the table of A.9), or `null`. */
export function fixFor(
  failure: SessionStartFailure,
  engine: EngineEntry | null,
): SpaceEngineFix | null {
  switch (failure.kind) {
    case 'engine-not-found':
    case 'engine-not-installed': {
      const catalog = engine ? catalogEntryFor(engine) : null;
      if (catalog && catalog.catalogId !== 'claude-code') {
        const commandId = `engine-install:${catalog.catalogId}` as const;
        return {
          kind: 'install-engine',
          label: `Install ${catalog.name}`,
          commandId,
          commandLine: setupCommandLine(commandId),
          section: null,
        };
      }
      return {
        kind: 'set-up-claude-code',
        label: 'Set up Claude Code',
        commandId: null,
        commandLine: null,
        section: 'engines',
      };
    }
    case 'engine-not-signed-in': {
      // The engine's own catalog id names its sign-in command; a hand-added Claude Code uses
      // `claude-code` (M10.5).
      const catalog = engine ? catalogEntryFor(engine) : null;
      const catalogId = catalog?.catalogId ?? 'claude-code';
      const name = catalog?.name ?? 'Claude Code';
      const commandId = `engine-sign-in:${catalogId}`;
      return {
        kind: 'sign-in',
        label: `Sign in to ${name}`,
        commandId,
        commandLine: setupCommandLine(commandId),
        section: null,
      };
    }
    case 'python3-missing':
      return {
        kind: 'set-up-python3',
        label: 'Set up python3',
        commandId: null,
        commandLine: null,
        section: 'tools',
      };
    case 'not-installed':
    case 'install-record-unreadable':
    case 'plugin-missing':
    case 'check-missing':
    case 'check-altered':
      return {
        kind: 'reinstall-lore',
        label: 'Install the Lore again',
        commandId: null,
        commandLine: null,
        section: null,
      };
    case 'engine-not-supported':
      // The other `engine-not-supported` case (an engine that is not guarded at
      // all) never reaches here: rule 1 of A.9 refuses it before readiness runs.
      return {
        kind: 'edit-engine',
        label: 'Edit the engine',
        commandId: null,
        commandLine: null,
        section: null,
      };
    default:
      return null;
  }
}

/** The parameters of `engine`, each with what its argument list would do (M10.3). */
function paramsOf(engine: EngineEntry): SpaceEngineParam[] {
  const options = optionsFor(engine);
  return (engine.params ?? []).map((param) => {
    const effect = paramEffect(options, splitParamText(param.text));
    return {
      text: param.text,
      defaultOn: param.defaultOn,
      effect: effect.effect,
      options: effect.options,
    };
  });
}

/** The engine choice of A.9 for `context`. `remembered` is the engine id of the `session-engine` concern, or null. */
export async function engineChoice(
  engines: readonly EngineEntry[],
  readiness: (engineId: string) => Promise<SessionReadiness>,
  remembered: string | null,
): Promise<SpaceEngineChoice> {
  const options: SpaceEngineOption[] = [];
  const failures = new Map<string, SessionStartFailure>();

  for (const engine of engines) {
    const params = paramsOf(engine);
    if (!canRunGuardedSession(engine)) {
      options.push({
        engineId: engine.id,
        name: engine.name,
        canStart: false,
        reason: NOT_GUARDED_REASON,
        fix: null,
        params,
        lore: loreReadiness(null, NOT_GUARDED_READINESS, null),
      });
      continue;
    }
    const ready = await readiness(engine.id);
    const lore = loreReadiness(adapterFor(engine), ready, ready.ok ? ready.value.skillCount : null);
    if (ready.ok) {
      options.push({
        engineId: engine.id,
        name: engine.name,
        canStart: true,
        reason: null,
        fix: null,
        params,
        lore,
      });
    } else {
      failures.set(engine.id, ready.error);
      options.push({
        engineId: engine.id,
        name: engine.name,
        canStart: false,
        reason: reasonFor(ready.error),
        fix: fixFor(ready.error, engine),
        params,
        lore,
      });
    }
  }

  const optionFor = (id: string): SpaceEngineOption | undefined =>
    options.find((option) => option.engineId === id);
  const rememberedOption = remembered !== null ? optionFor(remembered) : undefined;
  const firstStartable = options.find((option) => option.canStart);
  const engineId =
    rememberedOption?.canStart === true ? remembered : (firstStartable?.engineId ?? null);

  // The first guarded catalog engine (Claude Code today): its name backs the
  // button when nothing can start, and its own refusal is the one reported.
  const firstGuardedCatalog =
    engines.find((engine) => catalogEntryFor(engine)?.guardedSessions === true) ?? null;

  const buttonName =
    engineId !== null ? (optionFor(engineId)?.name ?? '') : (firstGuardedCatalog?.name ?? '');

  const refusal =
    engineId === null && firstGuardedCatalog !== null && failures.has(firstGuardedCatalog.id)
      ? {
          message: (failures.get(firstGuardedCatalog.id) as SessionStartFailure).message,
          fix: fixFor(
            failures.get(firstGuardedCatalog.id) as SessionStartFailure,
            firstGuardedCatalog,
          ),
        }
      : null;

  return { options, engineId, buttonName, refusal };
}
