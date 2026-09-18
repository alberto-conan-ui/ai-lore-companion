/**
 * The channels of the two dialogs a session asks for: the entering-Writing
 * dialog and the gate dialog. Phase M4.5. The handlers are in
 * `main/space/ipc/dialogs.ts` and the types in `./dialogs.types.ts`. This
 * fragment is spread into `CONTRACT`.
 *
 * Every invoke returns a `SpaceDialogsResult`. An answer is accepted only from
 * the Space window of the Space whose session asked.
 */

import { invoke, push } from './describe.js';
import type {
  GateDialogAnswered,
  PendingDialogs,
  PendingDialogsPayload,
  SpaceDialogAnswerGateArg,
  SpaceDialogAnswerWritingArg,
  SpaceDialogTicketArg,
  SpaceDialogsPendingArg,
  SpaceDialogsResult,
  WritingDialogAnswered,
  WritingDialogView,
} from './dialogs.types.js';

export const SPACE_DIALOGS_CONTRACT = {
  /** The requests that wait for the Human Lead. The first call of a Space starts the pushes below. */
  spaceDialogsPending: invoke<[arg: SpaceDialogsPendingArg], SpaceDialogsResult<PendingDialogs>>(
    'space:dialogs-pending',
  ),
  /** What the entering-Writing dialog shows for a pending request, read from the desk now. */
  spaceDialogWritingView: invoke<
    [arg: SpaceDialogTicketArg],
    SpaceDialogsResult<WritingDialogView>
  >('space:dialog-writing-view'),
  /** Confirm or decline a request to enter Writing. */
  spaceDialogAnswerWriting: invoke<
    [arg: SpaceDialogAnswerWritingArg],
    SpaceDialogsResult<WritingDialogAnswered>
  >('space:dialog-answer-writing'),
  /** Answer a gate: yes, no or take-over. The companion records it on the desk. */
  spaceDialogAnswerGate: invoke<
    [arg: SpaceDialogAnswerGateArg],
    SpaceDialogsResult<GateDialogAnswered>
  >('space:dialog-answer-gate'),
  /** A request was asked, answered or cancelled. Sent to the windows of that Space only. */
  onSpaceDialogsPending: push<PendingDialogsPayload>('space:on-dialogs-pending'),
} as const;
