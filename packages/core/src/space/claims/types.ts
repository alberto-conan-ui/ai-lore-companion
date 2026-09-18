/**
 * The shapes of the claim rules: what a session asks for, what is granted, and
 * why a request is refused.
 *
 * This file imports types only, so the renderer can take every type here with
 * `import type`. Every shape is plain data and crosses IPC as it is.
 */

import type { Claim, SessionMode, SessionRecord, WriteTarget } from '../desk/types.js';
import type { SpaceManifest } from '../manifest/space-manifest.js';

/**
 * A write target as a request names it, before the rules have looked at it.
 * A request comes from a session, so nothing about it is taken as given: the
 * kind may be one the rules do not know, and a repository may come without a
 * branch. The rules turn a target that passes into a `WriteTarget`.
 */
export type RequestedTarget = { kind: string; name?: string; branch?: string };

/**
 * What a session asks for when it asks to enter Writing, or to hold more
 * targets while it is in Writing. The fields are those of the tool
 * `request_writing` of the Lore's cards, and `sessionId` is the session the
 * local server received the request from.
 */
export type WritingRequest = {
  sessionId: string;
  /** Every target is granted, or none is. */
  targets: readonly RequestedTarget[];
  /** The number of the item's issue, when the session is on an item. The rules do not read it. */
  item?: number;
  /** One sentence that says what will be written, for the dialog. The rules do not read it. */
  reason?: string;
};

/** The part of the Space's manifest that the claim rules read: the payloads a claim can name. */
export type ClaimablePayloads = Pick<SpaceManifest, 'repositories' | 'publishAreas'>;

/** What the rules decide over: the manifest, and the desk's sessions and claims as they are now. */
export type ClaimState = {
  manifest: ClaimablePayloads;
  sessions: readonly SessionRecord[];
  claims: readonly Claim[];
};

/**
 * Why a request is refused.
 *
 * - `empty-request`: the request names no target.
 * - `session-unknown`: the desk has no record of the session.
 * - `session-ended`: the session's record has a close time.
 * - `unknown-target`: a target is not the Lore, a publish area or a repository, or has no name.
 * - `not-in-manifest`: the manifest lists no repository or publish area of that name.
 * - `branch-missing`: a repository is asked for without a branch.
 * - `branch-invalid`: the branch is not a name that git accepts.
 * - `asked-twice`: one request names one target twice.
 * - `held`: another session holds the target. `holder` is its claim.
 * - `already-held`: the asking session holds the target already, on whatever branch.
 */
export type WritingRefusalKind =
  | 'empty-request'
  | 'session-unknown'
  | 'session-ended'
  | 'unknown-target'
  | 'not-in-manifest'
  | 'branch-missing'
  | 'branch-invalid'
  | 'asked-twice'
  | 'held'
  | 'already-held';

/** One reason of a refusal. `message` is a sentence the dialog can show as it is. */
export type WritingRefusalReason = {
  kind: WritingRefusalKind;
  message: string;
  /** The target the reason is about, as the request named it. Absent for a reason about the session or the request. */
  target?: RequestedTarget;
  /** For `held` and `already-held`: the claim that holds the target. */
  holder?: Claim;
};

/**
 * A refused request. Nothing is granted when one target is refused. `kind` is
 * the kind of the first reason, `message` is the sentences of all reasons, and
 * `reasons` has one entry per problem found, in the order of the request.
 */
export type WritingRefusal = {
  kind: WritingRefusalKind;
  message: string;
  reasons: WritingRefusalReason[];
};

/**
 * A request that may be granted once the Human Lead confirms it: the targets
 * the session would hold, and the mode it would go from and to.
 */
export type WritingGrant = {
  sessionId: string;
  targets: WriteTarget[];
  modeBefore: SessionMode;
  mode: 'writing';
};

/** What leaving Writing does: the claims it releases, and the mode the session goes from and to. */
export type WritingLeave = {
  sessionId: string;
  release: Claim[];
  modeBefore: SessionMode;
  mode: 'read-only';
};

/** What changes a session's mode. */
export type SessionModeEvent = 'writing-granted' | 'writing-left' | 'session-ended';

/** One row of the entering-Writing dialog: a target of the Space and who holds it now. */
export type ClaimableTarget = {
  kind: WriteTarget['kind'];
  /** The name of the repository or the publish area; `null` for the Lore. */
  name: string | null;
  /** The claim that holds the target, or `null` when it is free. */
  holder: Claim | null;
  /** Whether the holder is the session the list was made for. */
  heldByThisSession: boolean;
};
