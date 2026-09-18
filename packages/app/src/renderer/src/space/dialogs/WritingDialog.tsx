import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConfirmedTarget,
  PendingDialog,
  WritingDialogView,
  WritingTargetRow,
} from '../../../../shared/ipc.js';
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
  monoStyle,
  noteStyle,
  warnNoteStyle,
} from './dialogParts.js';

type Props = {
  request: Extract<PendingDialog, { kind: 'writing' }>;
  position: number;
  count: number;
  onClose: () => void;
};

/** A target as the dialog names it: its kind as core names it, and its name. */
export function targetLabel(row: Pick<WritingTargetRow, 'kind' | 'name'>): string {
  return row.name === null ? row.kind : `${row.kind} ${row.name}`;
}

/** What confirming a target allows, in one sentence. */
export function grantSentence(row: WritingTargetRow, branch: string): string {
  if (row.kind === 'lore') return 'The session may write in the Lore.';
  if (row.kind === 'publish-area') {
    return `The session may write in the publish area "${row.name}", and in no other publish area.`;
  }
  return `The session may write in the repository "${row.name}", only on the branch "${branch}".`;
}

type Choice = { checked: boolean; branch: string };

function rowKey(row: WritingTargetRow): string {
  return `${row.kind}:${row.name ?? ''}`;
}

function initialChoices(view: WritingDialogView): Record<string, Choice> {
  const choices: Record<string, Choice> = {};
  for (const row of view.targets) {
    choices[rowKey(row)] = {
      checked: row.heldBy === null && row.problem === null,
      branch: row.branch ?? '',
    };
  }
  return choices;
}

/**
 * The entering-Writing dialog. It reads the request's view from main when it
 * opens: who holds each target now, and whether GitHub answered. A target
 * another session holds is shown with its holder and cannot be chosen. The
 * branch of a repository can be changed. Confirm sends the ticket and the
 * chosen targets; main checks them against the broker's record of the request.
 * Closing the dialog answers nothing.
 */
export function WritingDialog({ request, position, count, onClose }: Props): JSX.Element {
  const [view, setView] = useState<WritingDialogView | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set from the first click until main refuses: a second click sends nothing. */
  const sending = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await window.cockpit.spaceDialogWritingView({ ticket: request.ticket });
    if (result.ok) {
      setView(result.value);
      setChoices(initialChoices(result.value));
    } else {
      setError(result.error.message);
    }
  }, [request.ticket]);

  useEffect(() => {
    void load();
  }, [load]);

  const chosen: ConfirmedTarget[] = (view?.targets ?? [])
    .filter((row) => choices[rowKey(row)]?.checked === true)
    .map((row) => {
      if (row.kind === 'lore') return { kind: 'lore' };
      if (row.kind === 'publish-area') return { kind: 'publish-area', name: row.name ?? '' };
      return {
        kind: 'repository',
        name: row.name ?? '',
        branch: (choices[rowKey(row)]?.branch ?? '').trim(),
      };
    });
  const missingBranch = chosen.some(
    (target) => target.kind === 'repository' && (target.branch ?? '') === '',
  );

  const answer = async (confirm: boolean): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await window.cockpit.spaceDialogAnswerWriting(
      confirm
        ? { ticket: request.ticket, confirm: true, targets: chosen }
        : { ticket: request.ticket, confirm: false },
    );
    // On success the push from main removes the request and closes this dialog; until then
    // Confirm and Decline stay disabled.
    if (result.ok) return;
    sending.current = false;
    setBusy(false);
    setError(result.error.message);
    // Another session may have taken a target meanwhile: show the desk as it is now.
    if (result.error.kind === 'target-held') void load();
  };

  const setChoice = (row: WritingTargetRow, change: Partial<Choice>): void => {
    setChoices((before) => {
      const key = rowKey(row);
      const current = before[key] ?? { checked: false, branch: row.branch ?? '' };
      return { ...before, [key]: { ...current, ...change } };
    });
  };

  return (
    <ModalSheet
      label="Enter Writing"
      onClose={onClose}
      testId="writing-dialog"
      backdropTestId="writing-dialog-backdrop"
      panelStyle={dialogPanelStyle}
    >
      <div style={dialogHeaderStyle}>
        <h2 style={dialogHeadingStyle}>Enter Writing</h2>
        <span style={countStyle} data-testid="dialog-count">
          Request {position} of {count}
        </span>
      </div>
      <dl style={fieldListStyle}>
        <Field term="Session" testId="writing-session">
          {askerWords(view?.session ?? request.session)}
        </Field>
        <Field term="Item">{request.item === null ? 'None' : `#${request.item}`}</Field>
        <Field term="Reason" testId="writing-reason">
          {request.reason}
        </Field>
        <Field term="Asked at">{request.askedAt}</Field>
      </dl>

      {view === null ? (
        error === null ? (
          <output style={{ ...noteStyle, display: 'block' }}>
            Reading the desk and asking GitHub.
          </output>
        ) : null
      ) : (
        <>
          {view.github.reachable ? null : (
            <p style={warnNoteStyle} role="note" data-testid="writing-github-unreachable">
              GitHub cannot be reached: {view.github.message} Targets held on other desks cannot be
              checked. The claim is still recorded on this desk and the session can write. The
              update of the plan on GitHub will fail, and the session is told so.
            </p>
          )}
          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Targets</legend>
            {view.targets.map((row) => {
              const key = rowKey(row);
              const choice = choices[key] ?? { checked: false, branch: row.branch ?? '' };
              const blocked = row.heldBy !== null || row.problem !== null;
              const id = `writing-target-${key}`;
              return (
                <div key={key} style={rowStyle} data-testid={`writing-target-${key}`}>
                  <div style={rowLineStyle}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={choice.checked && !blocked}
                      disabled={blocked || busy}
                      onChange={(event) => setChoice(row, { checked: event.target.checked })}
                      data-testid={`writing-target-check-${key}`}
                    />
                    <label htmlFor={id} style={monoStyle}>
                      {targetLabel(row)}
                    </label>
                    {row.kind === 'repository' ? (
                      <label style={branchLabelStyle}>
                        branch
                        <input
                          type="text"
                          value={choice.branch}
                          disabled={blocked || busy}
                          onChange={(event) => setChoice(row, { branch: event.target.value })}
                          aria-label={`branch of ${targetLabel(row)}`}
                          style={branchInputStyle}
                          data-testid={`writing-target-branch-${key}`}
                        />
                      </label>
                    ) : null}
                  </div>
                  {row.heldBy !== null ? (
                    <p style={heldStyle} data-testid={`writing-target-held-${key}`}>
                      Held by {row.heldBy}. It cannot be chosen.
                    </p>
                  ) : null}
                  {row.problem !== null ? <p style={heldStyle}>{row.problem}</p> : null}
                  {!blocked ? (
                    <p style={noteStyle} data-testid={`writing-target-allows-${key}`}>
                      {grantSentence(row, choice.branch.trim())}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <p style={noteStyle}>
            The session writes only in the targets confirmed here, and in the Workbench. Confirm
            records the claim and the mode on the desk.
          </p>
        </>
      )}

      {error !== null ? (
        <p style={errorAreaStyle} role="alert" data-testid="writing-dialog-error">
          {error}
        </p>
      ) : null}
      <div style={actionsStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>
          Close without answering
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={busy}
          onClick={() => void answer(false)}
          data-testid="writing-decline"
        >
          Decline
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={busy || view === null || chosen.length === 0 || missingBranch}
          onClick={() => void answer(true)}
          data-testid="writing-confirm"
        >
          Confirm
        </button>
      </div>
    </ModalSheet>
  );
}

const fieldsetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  margin: 0,
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
};

const legendStyle: React.CSSProperties = {
  padding: '0 0.25rem',
  color: 'var(--color-text-secondary)',
};

const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

const rowLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const branchLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  marginLeft: 'auto',
  color: 'var(--color-text-secondary)',
};

const branchInputStyle: React.CSSProperties = {
  width: '14rem',
  padding: '0.2rem 0.4rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  color: 'var(--color-text)',
  background: 'var(--color-inset)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
};

const heldStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-warn-fg)',
};
