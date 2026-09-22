/**
 * Type guards for the desk's records, written by hand because core has no
 * schema library.
 *
 * A guard checks the fields this build uses and accepts any other field, so a
 * record written by a newer build is still read, and its extra fields are kept
 * when the file is written back. A guard never throws.
 */

import type {
  Claim,
  DeskOwner,
  FirstSeen,
  GateAnswer,
  IssueRef,
  JsonObject,
  JsonValue,
  PendingWrite,
  ReviewedMark,
  SessionClose,
  SessionProfile,
  SessionPurpose,
  SessionRecord,
  SessionSpend,
  StatusWrite,
  UnattendedTag,
  WriteTarget,
} from './types.js';

/** Whether `value` is a JSON object (not an array, not `null`). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isOptional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

/** Whether `value` is an array of non-empty strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isText(entry));
}

/** Whether `value` is a date and time that `Date` can read. */
function isTimestamp(value: unknown): value is string {
  return isText(value) && !Number.isNaN(Date.parse(value));
}

/** Whether `value` is an `IssueRef`. */
export function isIssueRef(value: unknown): value is IssueRef {
  return (
    isJsonObject(value) &&
    isText(value.repository) &&
    typeof value.number === 'number' &&
    Number.isInteger(value.number) &&
    typeof value.url === 'string'
  );
}

/**
 * Whether `value` is a `WriteTarget`. The rule is the one the `write-guard`
 * check script applies: a publish area has a name, a repository has a name and
 * a branch, and neither is empty.
 */
export function isWriteTarget(value: unknown): value is WriteTarget {
  if (!isJsonObject(value)) return false;
  if (value.kind === 'lore') return true;
  if (value.kind === 'publish-area') return isText(value.name);
  if (value.kind === 'repository') return isText(value.name) && isText(value.branch);
  return false;
}

/** Whether `value` is a non-negative integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Whether `value` is a non-negative finite number. */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

type SessionSpendTokens = NonNullable<SessionSpend['tokens']>;

/** Whether `value` is a `SessionSpend`'s `tokens`. */
function isSessionSpendTokens(value: unknown): value is SessionSpendTokens {
  return (
    isJsonObject(value) &&
    isOptional(value.input, isNonNegativeInteger) &&
    isOptional(value.output, isNonNegativeInteger) &&
    isOptional(value.cacheRead, isNonNegativeInteger) &&
    isOptional(value.cacheWrite, isNonNegativeInteger)
  );
}

/** Whether `value` is a `SessionProfile`. */
export function isSessionProfile(value: unknown): value is SessionProfile {
  return (
    isJsonObject(value) &&
    isText(value.id) &&
    isText(value.name) &&
    isText(value.engine) &&
    isOptional(value.model, (model) => typeof model === 'string')
  );
}

/** Whether `value` is a `SessionSpend`. */
export function isSessionSpend(value: unknown): value is SessionSpend {
  return (
    isJsonObject(value) &&
    (value.source === 'engine' || value.source === 'none') &&
    isOptional(value.usd, isNonNegativeNumber) &&
    isOptional(value.tokens, isSessionSpendTokens) &&
    isOptional(value.model, (model) => typeof model === 'string')
  );
}

/** Whether a record's optional companion-owned purpose is understood by this build. */
export function isSessionPurpose(value: unknown): value is SessionPurpose {
  return value === 'pm' || value === 'dashboard-refresh';
}

/** Whether `value` is a `SessionRecord`. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isJsonObject(value) &&
    isText(value.id) &&
    isText(value.engine) &&
    value.attended === true &&
    (value.mode === 'read-only' || value.mode === 'writing') &&
    isTimestamp(value.startedAt) &&
    isOptional(value.closedAt, isTimestamp) &&
    isOptional(value.item, isIssueRef) &&
    isOptional(value.issue, isIssueRef) &&
    isOptional(value.unguarded, isStringArray) &&
    isOptional(value.profile, isSessionProfile) &&
    isOptional(value.purpose, isSessionPurpose) &&
    isOptional(value.params, isStringArray) &&
    isOptional(value.spend, isSessionSpend)
  );
}

/** Whether `value` is a `Claim`. */
export function isClaim(value: unknown): value is Claim {
  return (
    isJsonObject(value) &&
    isText(value.sessionId) &&
    isWriteTarget(value.target) &&
    isTimestamp(value.claimedAt)
  );
}

/** Whether `value` is a `StatusWrite`. */
export function isStatusWrite(value: unknown): value is StatusWrite {
  return (
    isJsonObject(value) &&
    isText(value.key) &&
    isText(value.set) &&
    isTimestamp(value.setAt) &&
    isOptional(value.overriddenAt, isTimestamp)
  );
}

/** Whether `value` is a `PendingWrite`. */
export function isPendingWrite(value: unknown): value is PendingWrite {
  if (
    !isJsonObject(value) ||
    !isText(value.id) ||
    !isText(value.sessionId) ||
    !isTimestamp(value.queuedAt) ||
    typeof value.attempts !== 'number'
  ) {
    return false;
  }
  if (value.kind === 'session-issue') return isText(value.column) && isJsonObject(value.content);
  if (value.kind === 'comment') return isIssueRef(value.issue) && isText(value.body);
  if (value.kind === 'move') return isIssueRef(value.issue) && isText(value.column);
  return false;
}

/** Whether `value` is a `GateAnswer`. */
export function isGateAnswer(value: unknown): value is GateAnswer {
  return (
    isJsonObject(value) &&
    isText(value.id) &&
    isText(value.sessionId) &&
    isText(value.process) &&
    isText(value.step) &&
    typeof value.question === 'string' &&
    (value.answer === 'yes' || value.answer === 'no' || value.answer === 'take-over') &&
    isTimestamp(value.answeredAt)
  );
}

/** Whether `value` is an `UnattendedTag`. */
export function isUnattendedTag(value: unknown): value is UnattendedTag {
  return isJsonObject(value) && isIssueRef(value.item) && isTimestamp(value.taggedAt);
}

/** Whether `value` is a `ReviewedMark`. */
export function isReviewedMark(value: unknown): value is ReviewedMark {
  return (
    isJsonObject(value) &&
    isText(value.rootId) &&
    isText(value.commit) &&
    isTimestamp(value.markedAt)
  );
}

/** Whether `value` is a `SessionClose`. */
export function isSessionClose(value: unknown): value is SessionClose {
  return (
    isJsonObject(value) &&
    isText(value.rootId) &&
    isText(value.commit) &&
    isText(value.sessionId) &&
    isTimestamp(value.at)
  );
}

/** Whether `value` is a `FirstSeen`. */
export function isFirstSeen(value: unknown): value is FirstSeen {
  return (
    isJsonObject(value) && isText(value.rootId) && isText(value.commit) && isTimestamp(value.at)
  );
}

/** Whether `value` is a `DeskOwner`. */
export function isDeskOwner(value: unknown): value is DeskOwner {
  return (
    isJsonObject(value) &&
    typeof value.pid === 'number' &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    isTimestamp(value.startedAt) &&
    isTimestamp(value.openedAt)
  );
}

/**
 * `value` in the form it has after it was written as JSON and read back:
 * `undefined` fields dropped, nothing but plain data. A value that cannot be
 * written as JSON gives `undefined`, which no guard accepts. A value from a
 * caller is checked in this form before it is stored.
 */
export function toPlainJson(value: unknown): JsonValue | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as JsonValue);
  } catch {
    return undefined;
  }
}
