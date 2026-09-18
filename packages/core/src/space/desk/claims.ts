/**
 * `claims.json`: the write targets that sessions hold on this desk.
 *
 * One target has one holder. The Lore is one target, a publish area is one
 * target, and a repository is one target whatever the branch, so one session
 * holds a repository at a time. `addClaims` refuses a target that is held,
 * inside the same step that writes, so the record never holds two claims on
 * one target. The claim rules in `space/claims` are a pure function over the
 * list that `listClaims` returns, for the dialog that shows who holds what.
 *
 * The `write-guard` check script reads `sessionId` and `target` (`kind`,
 * `name`, `branch`) of each record of this file.
 */

import { type Result, err, fail, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isClaim, isJsonObject, isWriteTarget, toPlainJson } from './guards.js';
import { type DeskRecordFile, readDeskRecords, updateDeskRecords } from './store.js';
import type { Claim, ClaimsHeldFailure, JsonValue, WriteTarget } from './types.js';

/** The record file of the claims. */
export const CLAIMS_FILE: DeskRecordFile<Claim> = { name: 'claims', guard: isClaim };

/**
 * Whether two write targets are the same target. A repository is one target
 * whatever the branch, so the branch is not compared.
 */
export function sameWriteTarget(a: WriteTarget, b: WriteTarget): boolean {
  if (a.kind === 'lore' || b.kind === 'lore') return a.kind === b.kind;
  return a.kind === b.kind && a.name === b.name;
}

/** Every claim on the desk, oldest first. */
export function listClaims(desk: Desk): Result<Claim[], DeskFailure> {
  return readDeskRecords(desk, CLAIMS_FILE);
}

/** A write target as a message shows it. */
function shownTarget(target: WriteTarget): string {
  if (target.kind === 'lore') return 'the Lore';
  if (target.kind === 'publish-area') return `the publish area "${target.name}"`;
  return `the repository "${target.name}"`;
}

/** A claim as a message shows it: the target, its holder, and the branch of a repository. */
function shownClaim(claim: Claim): string {
  const branch =
    claim.target.kind === 'repository' ? ` on the branch "${claim.target.branch}"` : '';
  return `${shownTarget(claim.target)} is held by the session "${claim.sessionId}"${branch}`;
}

/**
 * Record that `sessionId` holds each of `targets`, in one write. The time of
 * the claim is the desk's clock. One target has one holder: the call fails with
 * `held`, naming each holder, when another session holds one of the targets,
 * and with `duplicate` when `sessionId` holds one already, on whatever branch;
 * a session that changes the branch of a repository releases its claim first.
 * The check and the write are one step. Nothing is written when the call fails
 * or when one target is malformed or is asked for twice.
 */
export function addClaims(
  desk: Desk,
  sessionId: string,
  targets: readonly WriteTarget[],
): Result<Claim[], DeskFailure | ClaimsHeldFailure> {
  const claimedAt = desk.now().toISOString();
  const added: Claim[] = [];
  const plain: JsonValue[] = [];
  for (const target of targets) {
    const candidate = toPlainJson({ sessionId, target, claimedAt });
    if (!isClaim(candidate) || !isJsonObject(candidate)) {
      return fail('invalid-record', 'a claim needs a session id and a well-formed write target');
    }
    if (added.some((claim) => sameWriteTarget(claim.target, candidate.target))) {
      return fail('invalid-record', `${shownTarget(candidate.target)} is asked for twice`);
    }
    added.push(candidate);
    plain.push(candidate);
  }
  return updateDeskRecords<Claim, Claim[], ClaimsHeldFailure>(desk, CLAIMS_FILE, (records) => {
    const taken = records
      .filter(isClaim)
      .filter((claim) => added.some((asked) => sameWriteTarget(asked.target, claim.target)));
    const held = taken.filter((claim) => claim.sessionId !== sessionId);
    if (held.length > 0) {
      return err({ kind: 'held', message: `${held.map(shownClaim).join('; ')}`, held });
    }
    const own = taken[0];
    if (own !== undefined) {
      return fail('duplicate', `${shownClaim(own)} already`);
    }
    return ok({ records: plain.length > 0 ? [...records, ...plain] : null, value: added });
  });
}

function removeClaims(
  desk: Desk,
  matches: (claim: Claim) => boolean,
): Result<Claim[], DeskFailure> {
  return updateDeskRecords(desk, CLAIMS_FILE, (records) => {
    const released: Claim[] = [];
    const kept = records.filter((record) => {
      if (!isClaim(record) || !matches(record)) return true;
      released.push(record);
      return false;
    });
    return ok({ records: released.length > 0 ? kept : null, value: released });
  });
}

/** Release every claim of `sessionId`. Returns the claims that were released. */
export function releaseClaims(desk: Desk, sessionId: string): Result<Claim[], DeskFailure> {
  return removeClaims(desk, (claim) => claim.sessionId === sessionId);
}

/** Release the claim of `sessionId` on `target`. Returns the claims that were released. */
export function releaseClaim(
  desk: Desk,
  sessionId: string,
  target: WriteTarget,
): Result<Claim[], DeskFailure> {
  if (!isWriteTarget(toPlainJson(target))) {
    return fail('invalid-record', 'the write target is malformed');
  }
  return removeClaims(
    desk,
    (claim) => claim.sessionId === sessionId && sameWriteTarget(claim.target, target),
  );
}
