/**
 * What the AI tab of a Space window shows beside its terminal (phase M4.6):
 * the session header, read from the desk, and the Skills column, read from the
 * Lore and the Space's install (M10.5: each skill's `invocation` is the chosen
 * engine's own form, from its adapter).
 *
 * The header is read again from the desk whenever the dialog broker tells of a
 * change of mode (a request to enter Writing settled, or the session left
 * Writing): the broker is the only writer of those records, so the header
 * follows the desk. The renderer holds no mode of its own.
 */

import {
  type Desk,
  type DeskFailure,
  type Result,
  getSession,
  listClaims,
  readLore,
} from '@ai-lore-companion/core';
import type { SpaceSessionHeader, SpaceSkill, SpaceSkillsResult } from '../../../shared/ipc.js';
import type { SpaceContext } from '../context.js';
import { sessionServer } from '../session-server/index.js';
import { readInstalledSkills } from './engines/skills.js';
import type { EngineAdapter } from './engines/types.js';

/** The header of `sessionId` as the desk records it now, or `null` when the desk has no such session. */
export function readSessionHeader(
  desk: Desk,
  sessionId: string,
): Result<SpaceSessionHeader | null, DeskFailure> {
  const record = getSession(desk, sessionId);
  if (!record.ok) return record;
  if (record.value === null) return { ok: true, value: null };
  const claims = listClaims(desk);
  if (!claims.ok) return claims;
  return {
    ok: true,
    value: {
      sessionId,
      engineId: record.value.engine,
      mode: record.value.mode,
      targets: claims.value
        .filter((claim) => claim.sessionId === sessionId)
        .map((claim) => claim.target),
      item: record.value.item ?? null,
      closed: record.value.closedAt !== undefined,
      unguarded: record.value.unguarded ?? [],
    },
  };
}

const watched = new WeakSet<SpaceContext>();

/**
 * Push a session's header to the windows of its Space each time the broker
 * tells of a change of mode. Once per context; the subscription ends with the
 * broker, which the context disposes.
 */
export function pushHeadersOnChange(
  context: SpaceContext,
  desk: () => Result<Desk, DeskFailure>,
  send: (header: SpaceSessionHeader) => void,
): void {
  if (watched.has(context)) return;
  watched.add(context);
  context.service(sessionServer).broker.subscribe((event) => {
    const sessionId =
      event.kind === 'left-writing'
        ? event.sessionId
        : event.kind === 'settled' && event.request.kind === 'writing'
          ? event.request.sessionId
          : null;
    if (sessionId === null) return;
    const opened = desk();
    if (!opened.ok) return;
    const header = readSessionHeader(opened.value, sessionId);
    if (header.ok && header.value !== null) send(header.value);
    else if (!header.ok) {
      context.log.warn('session-header-not-read', {
        space: context.key,
        session: sessionId,
        kind: header.error.kind,
      });
    }
  });
}

/**
 * The skills of the Space: every verb and process of the Lore in use whose
 * `SKILL.md` is in the install's plugin (read with `readInstalledSkills`, M10.5).
 * The others are named in `notInstalled`. `invocation` comes from `adapter`'s
 * own form, or `/lore:<name>` when `adapter` is `null` (no engine named, or an
 * engine with no adapter).
 */
export async function readSpaceSkills(
  spaceRoot: string,
  installDir: string,
  adapter: EngineAdapter | null,
): Promise<SpaceSkillsResult> {
  const lore = await readLore(spaceRoot);
  if (!lore.ok) {
    return {
      ok: false,
      error: {
        kind: 'lore-unreadable',
        message: `The skills cannot be listed: ${lore.error.message}.`,
      },
    };
  }
  const installed = await readInstalledSkills(installDir, spaceRoot);
  const byName = new Map(installed.map((skill) => [skill.name, skill]));
  const skills: SpaceSkill[] = [];
  const notInstalled: string[] = [];
  const entries = [
    ...lore.value.parts.processes.map((entry) => ({ entry, part: 'processes' as const })),
    ...lore.value.parts.verbs.map((entry) => ({ entry, part: 'verbs' as const })),
  ];
  for (const { entry, part } of entries) {
    const found = byName.get(entry.name);
    if (found === undefined) {
      notInstalled.push(entry.name);
      continue;
    }
    skills.push({
      name: entry.name,
      part,
      layer: entry.layer,
      // The description as installed (`readInstalledSkills` only keeps a skill that has one).
      description: found.description,
      invocation: adapter?.skillInvocation(entry.name) ?? `/lore:${entry.name}`,
    });
  }
  return { ok: true, value: { skills, notInstalled } };
}
