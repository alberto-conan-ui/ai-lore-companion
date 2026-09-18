/**
 * The claim rules: who may take which write target, and what a session's mode
 * becomes. Pure functions over the manifest and the desk's sessions and claims.
 * Phase M4.2. The functions that apply a decision to the desk are in
 * `desk/lifecycle.ts`.
 */

export type {
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
export {
  branchNameProblem,
  decideLeaveWriting,
  decideWritingRequest,
  describeWriteTarget,
  listClaimableTargets,
  resolveRequestedTarget,
  sessionModeAfter,
  tryClaim,
} from './rules.js';
