/**
 * The claim rules: who may take which write target, and what a session's mode
 * becomes. Phase M4.2.
 *
 * Every function here is pure and synchronous. It reads the manifest and the
 * desk's sessions and claims as its caller gives them, and writes nothing. The
 * functions of `desk/lifecycle.ts` apply a decision to the desk.
 *
 * The rules, from the product document:
 *
 * - The Lore is one target and has one holder.
 * - A publish area is one target.
 * - A repository is one target whatever the branch, so one session holds a
 *   repository at a time. It is claimed whole, on one named branch. A session
 *   that changes the branch leaves Writing and asks again.
 * - A session may hold several targets, and may ask for more while it is in
 *   Writing. A request is granted whole or not at all.
 * - The Workbench is always writable and is never a target.
 * - A claim names a payload that the Space's manifest lists.
 *
 * A session has two modes, Read only and Writing. Blocked is the state of an
 * unattended session at a gate; unattended sessions are a non-goal of the MVP,
 * so no rule here produces it.
 */

import { sameWriteTarget } from '../desk/claims.js';
import type { Claim, SessionMode, SessionRecord, WriteTarget } from '../desk/types.js';
import { type Result, err, ok } from '../result.js';
import type {
  ClaimState,
  ClaimablePayloads,
  ClaimableTarget,
  RequestedTarget,
  SessionModeEvent,
  WritingGrant,
  WritingLeave,
  WritingRefusal,
  WritingRefusalKind,
  WritingRefusalReason,
  WritingRequest,
} from './types.js';

/** A name inside a sentence, with quotes, and with control characters written as escapes so the sentence stays on one line. */
function quoted(value: unknown): string {
  return JSON.stringify(typeof value === 'string' ? value : String(value));
}

/** A write target as a sentence names it. */
export function describeWriteTarget(target: WriteTarget): string {
  if (target.kind === 'lore') return 'the Lore';
  if (target.kind === 'publish-area') return `the publish area ${quoted(target.name)}`;
  return `the repository ${quoted(target.name)}`;
}

/** A write target at the start of a sentence. */
function sentenceStart(target: WriteTarget): string {
  const text = describeWriteTarget(target);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function onBranch(target: WriteTarget): string {
  return target.kind === 'repository' ? ` on the branch ${quoted(target.branch)}` : '';
}

/**
 * A refusal with the reasons found. `reasons` has at least one entry. Used by
 * `desk/lifecycle.ts` as well; not part of the module's public names.
 */
export function refusal(reasons: WritingRefusalReason[]): WritingRefusal {
  const first = reasons[0];
  const kind: WritingRefusalKind = first === undefined ? 'empty-request' : first.kind;
  return { kind, message: reasons.map((reason) => reason.message).join(' '), reasons };
}

// The characters git refuses anywhere in a reference name: control characters, space, ~ ^ : ? * [ \ and DEL.
function isRefusedByGit(code: number): boolean {
  return code <= 0x20 || code === 0x7f || '~^:?*[\\'.includes(String.fromCharCode(code));
}

/**
 * Why `name` is not a branch name that git accepts, as the end of a sentence,
 * or `null` when it is one. The rules are those of `git check-ref-format
 * --branch`, written out here because a rule function starts no process; an
 * integration test compares the two on a list of names.
 *
 * One name is refused here that the command accepts: a single `@`. In a git
 * command `@` is another way to write `HEAD`, so `git checkout @` and
 * `git branch @` do not reach a branch of that name, and a claim "on the branch
 * @" reads as a claim on whatever is checked out. A claim names its branch
 * literally, and the `write-guard` check compares that name with the branch
 * that is checked out, so the rule refuses the one name that cannot be used
 * that way. git's own rules for a reference name say that it cannot be the
 * single character `@` (`git check-ref-format --allow-onelevel @` fails).
 */
export function branchNameProblem(name: string): string | null {
  if (name === '') return 'it is empty';
  if (name === 'HEAD') return 'HEAD is not a branch';
  if (name === '@') return 'a single @ stands for HEAD in git and is not the name of a branch';
  if (name.startsWith('-')) return 'it begins with a hyphen';
  if (name.startsWith('/') || name.endsWith('/')) return 'it begins or ends with a slash';
  if (name.endsWith('.')) return 'it ends with a dot';
  if (name.includes('..')) return 'it has two dots in a row';
  if (name.includes('@{')) return 'it has the sequence @{';
  for (let index = 0; index < name.length; index += 1) {
    if (isRefusedByGit(name.charCodeAt(index))) {
      return 'it has a space, a control character or one of ~ ^ : ? * [ \\';
    }
  }
  for (const part of name.split('/')) {
    if (part === '') return 'it has two slashes in a row';
    if (part.startsWith('.')) return 'a part of it begins with a dot';
    if (part.endsWith('.lock')) return 'a part of it ends with .lock';
  }
  return null;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function listed(names: readonly string[]): string {
  return names.length === 0 ? 'It lists none.' : `It lists: ${names.map(quoted).join(', ')}.`;
}

/**
 * Turn a target as a request names it into a `WriteTarget`, or say why it is
 * not one the Space has: a kind the rules do not know, no name, a name the
 * manifest does not list, no branch, or a branch name git does not accept.
 */
export function resolveRequestedTarget(
  manifest: ClaimablePayloads,
  requested: RequestedTarget,
): Result<WriteTarget, WritingRefusalReason> {
  const asked: unknown = requested;
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) {
    return err({
      kind: 'unknown-target',
      message:
        'A write target is the Lore, a publish area or a repository, and the request has an entry that is none of them.',
    });
  }
  const { kind, name, branch } = requested;
  const target: RequestedTarget = {
    kind: typeof kind === 'string' ? kind : String(kind),
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof branch === 'string' ? { branch } : {}),
  };
  if (kind === 'lore') return ok({ kind: 'lore' });
  if (kind !== 'publish-area' && kind !== 'repository') {
    return err({
      kind: 'unknown-target',
      message: `A write target is the Lore, a publish area or a repository, and ${quoted(kind)} is none of them. The Workbench is always writable and is not claimed.`,
      target,
    });
  }
  const what = kind === 'repository' ? 'repository' : 'publish area';
  if (!hasText(name)) {
    return err({
      kind: 'unknown-target',
      message: `A ${what} is asked for without its name.`,
      target,
    });
  }
  const names = (kind === 'repository' ? manifest.repositories : manifest.publishAreas).map(
    (payload) => payload.name,
  );
  // Names are compared letter by letter, as the write-guard check compares them.
  if (!names.includes(name)) {
    return err({
      kind: 'not-in-manifest',
      message: `The Space's manifest (lore/space.md) lists no ${what} named ${quoted(name)}. ${listed(names)}`,
      target,
    });
  }
  if (kind === 'publish-area') return ok({ kind: 'publish-area', name });
  if (!hasText(branch)) {
    return err({
      kind: 'branch-missing',
      message: `The repository ${quoted(name)} is asked for without a branch. A repository is claimed on one named branch.`,
      target,
    });
  }
  const problem = branchNameProblem(branch);
  if (problem !== null) {
    return err({
      kind: 'branch-invalid',
      message: `The repository ${quoted(name)} is asked for on the branch ${quoted(branch)}, which is not a branch name that git accepts: ${problem}.`,
      target,
    });
  }
  return ok({ kind: 'repository', name, branch });
}

/**
 * The reason that refuses `target` because another session holds it with the
 * claim `holder`. Used by `desk/lifecycle.ts` as well; not part of the module's
 * public names.
 */
export function heldReason(target: WriteTarget, holder: Claim): WritingRefusalReason {
  return {
    kind: 'held',
    message: `${sentenceStart(target)} is held by the session ${quoted(holder.sessionId)}${onBranch(holder.target)}. One session holds a target at a time.`,
    target,
    holder,
  };
}

/** The reasons, if any, that stop `sessionId` from taking `target` given `claims` and what it asks for beside it. */
function holdingReasons(
  claims: readonly Claim[],
  sessionId: string,
  target: WriteTarget,
  askedBefore: readonly WriteTarget[],
): WritingRefusalReason[] {
  if (askedBefore.some((earlier) => sameWriteTarget(earlier, target))) {
    return [
      {
        kind: 'asked-twice',
        message: `${sentenceStart(target)} is asked for twice in one request.`,
        target,
      },
    ];
  }
  const holder = claims.find((claim) => sameWriteTarget(claim.target, target));
  if (holder === undefined) return [];
  if (holder.sessionId !== sessionId) return [heldReason(target, holder)];
  // The product document lets a session change its targets while in Writing, and the desk
  // (`addClaims`) has a session release its claim on a repository before it claims another
  // branch. The session's tools are `request_writing` and `leave_writing`, and the second
  // releases every target, so the branch is changed by leaving Writing and asking again.
  // The Human Lead confirms the new branch in the dialog, as they confirmed the first.
  const change =
    target.kind === 'repository'
      ? ' To change the branch, the session leaves Writing and asks again.'
      : '';
  return [
    {
      kind: 'already-held',
      message: `${sentenceStart(target)} is already held by this session${onBranch(holder.target)}. A request names only targets that the session does not hold.${change}`,
      target,
      holder,
    },
  ];
}

const EMPTY_REQUEST: WritingRefusalReason = {
  kind: 'empty-request',
  message:
    'The request names no write target. A request to enter Writing names at least one: the Lore, a publish area, or a repository with its branch.',
};

/**
 * Whether `sessionId` may take every one of `targets`, given the claims on the
 * desk. One target has one holder, and a repository is one target whatever the
 * branch, so a second session is refused a held repository on any branch. The
 * answer is for the whole list: the targets, or every reason found. The time
 * of a claim is the desk's clock, so the value is the targets and not claims.
 */
export function tryClaim(
  claims: readonly Claim[],
  sessionId: string,
  targets: readonly WriteTarget[],
): Result<WriteTarget[], WritingRefusal> {
  if (targets.length === 0) return err(refusal([EMPTY_REQUEST]));
  const reasons: WritingRefusalReason[] = [];
  const asked: WriteTarget[] = [];
  for (const target of targets) {
    reasons.push(...holdingReasons(claims, sessionId, target, asked));
    asked.push(target);
  }
  return reasons.length > 0 ? err(refusal(reasons)) : ok(asked);
}

/** The session's record, or the reason a session that is not on the desk or has ended is refused. */
function openSession(
  sessions: readonly SessionRecord[],
  sessionId: string,
  what: string,
): Result<SessionRecord, WritingRefusal> {
  const session = sessions.find((record) => record.id === sessionId);
  if (session === undefined) {
    return err(
      refusal([
        {
          kind: 'session-unknown',
          message: `The desk has no record of the session ${quoted(sessionId)}, so it cannot ${what}. Only a session that the companion started has one.`,
        },
      ]),
    );
  }
  return ok(session);
}

/**
 * Decide a request to enter Writing, or to hold more targets while in Writing.
 * A granted request says what the session would hold and that its mode becomes
 * Writing. A refused request says every reason found, and grants nothing.
 *
 * The decision is what the dialog shows before the Human Lead answers, and
 * `enterWriting` takes it again when it writes, so a claim made in between is
 * seen.
 */
export function decideWritingRequest(
  state: ClaimState,
  request: WritingRequest,
): Result<WritingGrant, WritingRefusal> {
  const session = openSession(state.sessions, request.sessionId, 'enter Writing');
  if (!session.ok) return session;
  if (session.value.closedAt !== undefined) {
    return err(
      refusal([
        {
          kind: 'session-ended',
          message: `The session ${quoted(request.sessionId)} ended at ${session.value.closedAt} and cannot enter Writing.`,
        },
      ]),
    );
  }
  const requested: readonly RequestedTarget[] = Array.isArray(request.targets)
    ? request.targets
    : [];
  if (requested.length === 0) return err(refusal([EMPTY_REQUEST]));
  const reasons: WritingRefusalReason[] = [];
  const targets: WriteTarget[] = [];
  for (const entry of requested) {
    const resolved = resolveRequestedTarget(state.manifest, entry);
    if (!resolved.ok) {
      reasons.push(resolved.error);
      continue;
    }
    reasons.push(...holdingReasons(state.claims, request.sessionId, resolved.value, targets));
    targets.push(resolved.value);
  }
  if (reasons.length > 0) return err(refusal(reasons));
  return ok({
    sessionId: request.sessionId,
    targets,
    modeBefore: session.value.mode,
    mode: 'writing',
  });
}

/**
 * Decide what leaving Writing does for `sessionId`: every claim of the session
 * is released, and its mode becomes Read only. A session that is in Read only
 * already may leave again; that releases whatever it still holds and changes
 * nothing else. Refused only for a session the desk has no record of.
 */
export function decideLeaveWriting(
  state: Pick<ClaimState, 'sessions' | 'claims'>,
  sessionId: string,
): Result<WritingLeave, WritingRefusal> {
  const session = openSession(state.sessions, sessionId, 'leave Writing');
  if (!session.ok) return session;
  return ok({
    sessionId,
    release: state.claims.filter((claim) => claim.sessionId === sessionId),
    modeBefore: session.value.mode,
    mode: 'read-only',
  });
}

/**
 * The mode of a session after `event`. A granted request puts it in Writing;
 * leaving Writing and the end of the session put it in Read only. There is no
 * third mode in the MVP.
 */
export function sessionModeAfter(_mode: SessionMode, event: SessionModeEvent): SessionMode {
  return event === 'writing-granted' ? 'writing' : 'read-only';
}

/**
 * The targets of the Space as the entering-Writing dialog lists them: the
 * Lore, then each repository, then each publish area of the manifest, each
 * with the claim that holds it now. The dialog disables a target that another
 * session holds.
 */
export function listClaimableTargets(
  manifest: ClaimablePayloads,
  claims: readonly Claim[],
  sessionId: string,
): ClaimableTarget[] {
  const row = (kind: WriteTarget['kind'], name: string | null): ClaimableTarget => {
    const holder =
      claims.find(
        (claim) =>
          claim.target.kind === kind &&
          (claim.target.kind === 'lore' || claim.target.name === name),
      ) ?? null;
    return { kind, name, holder, heldByThisSession: holder?.sessionId === sessionId };
  };
  return [
    row('lore', null),
    ...manifest.repositories.map((repository) => row('repository', repository.name)),
    ...manifest.publishAreas.map((area) => row('publish-area', area.name)),
  ];
}
