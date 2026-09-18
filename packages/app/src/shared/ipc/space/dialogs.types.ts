/**
 * Argument, result and payload types of the channels of the two dialogs a
 * session asks for: the entering-Writing dialog and the gate dialog. Phase
 * M4.5. Plain data only. `shared/ipc.ts` re-exports this file.
 *
 * A request is named by its ticket, which the dialog broker in main made. The
 * renderer sends the ticket and the Human Lead's choice; main checks both
 * against the broker's own record of the request before it answers.
 */

/** Why a channel of the dialogs refused. A handler never rejects. */
export type SpaceDialogsFailureKind =
  /** The call did not come from a window of an open Space. */
  | 'not-a-space-window'
  /** An answer came from a window of the Space that is not its Space window. */
  | 'not-the-space-window'
  | 'invalid-argument'
  /** The broker has no pending request with this ticket. */
  | 'unknown-ticket'
  | 'already-answered'
  | 'wrong-kind'
  /** The confirmed targets are not some of the requested targets, or none. */
  | 'invalid-request'
  /** A confirmed target is held by another session. The request stays pending. */
  | 'target-held'
  /** A confirmed branch is not a name git accepts. The request stays pending. */
  | 'branch-invalid'
  | 'desk-failed'
  | 'closed'
  | 'failed';

export type SpaceDialogsFailure = { kind: SpaceDialogsFailureKind; message: string };

export type SpaceDialogsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SpaceDialogsFailure };

/** The session that asks, as its header shows it. Never its id. */
export type DialogAsker = {
  engine: string;
  /** ISO 8601. */
  startedAt: string;
  /** The number of the item the session is on, or `null`. */
  item: number | null;
};

/** A request that waits for the Human Lead, as the list of pending requests shows it. */
export type PendingDialog =
  | {
      kind: 'writing';
      ticket: string;
      /** ISO 8601. */
      askedAt: string;
      /** `null` when the desk has no record of the session. */
      session: DialogAsker | null;
      reason: string;
      /** The item the request names, or `null`. */
      item: number | null;
      /** The requested targets, each as a sentence names it. */
      targets: string[];
    }
  | {
      kind: 'gate';
      ticket: string;
      askedAt: string;
      session: DialogAsker | null;
      process: string;
      step: string;
      question: string;
      /** What the answer bears on, or `null`. */
      bearsOn: string | null;
    };

/** How a request that was pending ended, for the line the renderer shows after its dialog closes. */
export type SettledDialog = {
  ticket: string;
  kind: PendingDialog['kind'];
  /** `answered`: the Human Lead answered. `cancelled`: the session cancelled it, ended, or the request expired. */
  outcome: 'answered' | 'cancelled';
  message: string;
};

/** The requests that wait, oldest first. */
export type PendingDialogs = { requests: PendingDialog[] };

/** What the push of the dialogs carries: the list as it is now, and the request that just ended, if one did. */
export type PendingDialogsPayload = PendingDialogs & { settled: SettledDialog | null };

/** The kinds of write target, as core names them. */
export type DialogTargetKind = 'lore' | 'publish-area' | 'repository';

/** One requested target, as a row of the entering-Writing dialog. */
export type WritingTargetRow = {
  kind: DialogTargetKind;
  /** The name of the publish area or the repository; `null` for the Lore. */
  name: string | null;
  /** The branch the session asked for; `null` except for a repository. */
  branch: string | null;
  /**
   * The session that holds the target now, as "the <engine> session on item #N
   * that started at <time>"; `null` when no other session holds it.
   */
  heldBy: string | null;
  /** Why the target cannot be granted for a reason other than a holder, or `null`. */
  problem: string | null;
};

/** Whether GitHub answered when the dialog was opened. */
export type DialogGitHubState = { reachable: true } | { reachable: false; message: string };

/** What the entering-Writing dialog shows, read from the desk when it is asked for. */
export type WritingDialogView = {
  ticket: string;
  askedAt: string;
  session: DialogAsker | null;
  reason: string;
  item: number | null;
  targets: WritingTargetRow[];
  github: DialogGitHubState;
};

export type SpaceDialogsPendingArg = Record<string, never>;

export type SpaceDialogTicketArg = { ticket: string };

/** A confirmed target: one of the requested targets, a repository on the branch the Human Lead left or typed. */
export type ConfirmedTarget = { kind: DialogTargetKind; name?: string; branch?: string };

/** The Human Lead's answer in the entering-Writing dialog. */
export type SpaceDialogAnswerWritingArg =
  | { ticket: string; confirm: true; targets: ConfirmedTarget[] }
  | { ticket: string; confirm: false };

/** What the session was answered, in the words it reads. */
export type WritingDialogAnswered = { granted: boolean; message: string };

/** The three answers of a gate, as the process cards and the desk name them. */
export type DialogGateAnswer = 'yes' | 'no' | 'take-over';

export const DIALOG_GATE_ANSWERS: readonly DialogGateAnswer[] = ['yes', 'no', 'take-over'];

export type SpaceDialogAnswerGateArg = { ticket: string; answer: DialogGateAnswer };

/** The gate answer as the companion recorded it on the desk. */
export type GateDialogAnswered = { answer: DialogGateAnswer; answeredAt: string };
