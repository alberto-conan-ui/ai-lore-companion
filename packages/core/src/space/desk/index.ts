/**
 * The desk's records: sessions, claims, gate answers, unattended tags, reviewed
 * marks, session closes and first-seen commits, kept as JSON files in the
 * companion's data folder. Phase M2.4.
 *
 * The generic store (`store.ts`) is not re-exported: through this module the
 * appended records (reviewed marks, gate answers, session closes, first-seen
 * commits) can be added and listed, and not changed or removed. A module of
 * core that keeps another file of the desk imports `./desk/store.js` itself.
 */

export type {
  Claim,
  ClaimsHeldFailure,
  DeskFailureKind,
  DeskInstance,
  DeskNotice,
  DeskOwner,
  FirstSeen,
  GateAnswer,
  GateAnswerInput,
  GateAnswerValue,
  IssueRef,
  JsonObject,
  JsonValue,
  ReviewedMark,
  SessionClose,
  SessionMode,
  SessionPatch,
  SessionProfile,
  SessionPurpose,
  SessionRecord,
  SessionSpend,
  UnattendedTag,
  WriteTarget,
} from './types.js';
export {
  isClaim,
  isDeskOwner,
  isFirstSeen,
  isGateAnswer,
  isIssueRef,
  isReviewedMark,
  isSessionClose,
  isSessionProfile,
  isSessionPurpose,
  isSessionRecord,
  isSessionSpend,
  isUnattendedTag,
  isWriteTarget,
} from './guards.js';
export { type Desk, type DeskFailure, deskNotices } from './desk.js';
export { type OpenDeskOptions, closeDesk, openDesk } from './open.js';
export {
  DESK_DIR_MODE,
  DESK_FILE_MODE,
  DESK_OWNER_FILE,
  DESK_OWNER_VERSION,
  type OwnerProbe,
  type OwnershipOutcome,
  confirmDeskOwnership,
  currentDeskInstance,
  isDeskOwnerRunning,
  isProcessRunning,
  readDeskOwner,
  releaseDeskOwnership,
  takeDeskOwnership,
} from './owner.js';
export { DESK_RECORD_SIZE_LIMIT, DESK_RECORD_VERSION } from './store.js';
export { addSession, closeSession, getSession, listSessions, updateSession } from './sessions.js';
export { addClaims, listClaims, releaseClaim, releaseClaims, sameWriteTarget } from './claims.js';
// Phase M4.2: the steps of a session's life, which apply a decision of `space/claims`.
export {
  type EndOptions,
  type LeaveOptions,
  type LifecycleOptions,
  type SessionCloseCommit,
  type SessionRepair,
  type SessionStart,
  type WritingEntered,
  type WritingLeft,
  endSession,
  enterWriting,
  leaveWriting,
  repairSessionRecords,
  startSession,
} from './lifecycle.js';
export { listGateAnswers, recordGateAnswer } from './gate-answers.js';
export { addUnattendedTag, listUnattendedTags, removeUnattendedTag } from './unattended-tags.js';
export { addMark, lastMark, listMarks } from './marks.js';
export {
  getFirstSeen,
  listFirstSeen,
  listSessionCloses,
  recordFirstSeen,
  recordSessionClose,
} from './root-commits.js';
