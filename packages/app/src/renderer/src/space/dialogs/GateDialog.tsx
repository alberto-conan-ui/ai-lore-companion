import { type JSX, useRef, useState } from 'react';
import type { DialogGateAnswer, PendingDialog } from '../../../../shared/ipc.js';
import { ModalSheet } from '../../components/overlay/ModalSheet.js';
import { errorAreaStyle, primaryButtonStyle, secondaryButtonStyle } from '../styles.js';
import {
  Field,
  actionsStyle,
  askerWords,
  countStyle,
  dialogHeaderStyle,
  dialogHeadingStyle,
  dialogPanelStyle,
  fieldListStyle,
  noteStyle,
} from './dialogParts.js';

type Props = {
  request: Extract<PendingDialog, { kind: 'gate' }>;
  position: number;
  count: number;
  onClose: () => void;
};

/** The three answers of a gate, in the order the process cards list them, with their buttons' words. */
export const GATE_ANSWER_LABELS: readonly { answer: DialogGateAnswer; label: string }[] = [
  { answer: 'yes', label: 'Yes' },
  { answer: 'no', label: 'No' },
  { answer: 'take-over', label: 'Take over' },
];

/**
 * The gate dialog: the process, the step, the question the session asked and
 * what the answer bears on, and the three answers the process cards define.
 * An answer is one call to main with the ticket; the companion records it on
 * the desk and the session reads it. Closing the dialog answers nothing.
 */
export function GateDialog({ request, position, count, onClose }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set from the first click until main refuses: a second click sends nothing. */
  const sending = useRef(false);

  const answer = async (choice: DialogGateAnswer): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await window.cockpit.spaceDialogAnswerGate({
      ticket: request.ticket,
      answer: choice,
    });
    // On success the push from main removes the request and closes this dialog; until then
    // the answers stay disabled.
    if (result.ok) return;
    sending.current = false;
    setBusy(false);
    setError(result.error.message);
  };

  return (
    <ModalSheet
      label="Gate"
      onClose={onClose}
      testId="gate-dialog"
      backdropTestId="gate-dialog-backdrop"
      panelStyle={dialogPanelStyle}
    >
      <div style={dialogHeaderStyle}>
        <h2 style={dialogHeadingStyle}>Gate</h2>
        <span style={countStyle} data-testid="dialog-count">
          Request {position} of {count}
        </span>
      </div>
      <dl style={fieldListStyle}>
        <Field term="Session">{askerWords(request.session)}</Field>
        <Field term="Process" testId="gate-process">
          {request.process}
        </Field>
        <Field term="Step" testId="gate-step">
          {request.step}
        </Field>
        <Field term="Question" testId="gate-question">
          {request.question}
        </Field>
        <Field term="Bears on" testId="gate-bears-on">
          {request.bearsOn ?? 'The session did not say.'}
        </Field>
        <Field term="Asked at">{request.askedAt}</Field>
      </dl>
      <p style={noteStyle}>
        The companion records the answer on the desk, with the process, the step and the question.
        The session reads the answer and cannot write that record. Closing this dialog does not
        answer; the request stays in the list of requests.
      </p>
      {error !== null ? (
        <p style={errorAreaStyle} role="alert" data-testid="gate-dialog-error">
          {error}
        </p>
      ) : null}
      <div style={actionsStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>
          Close without answering
        </button>
        {GATE_ANSWER_LABELS.map(({ answer: choice, label }) => (
          <button
            key={choice}
            type="button"
            style={choice === 'yes' ? primaryButtonStyle : secondaryButtonStyle}
            disabled={busy}
            onClick={() => void answer(choice)}
            data-testid={`gate-answer-${choice}`}
          >
            {label}
          </button>
        ))}
      </div>
    </ModalSheet>
  );
}
