import { type JSX, useEffect, useState } from 'react';
import {
  cardStyle,
  errorAreaStyle,
  hintStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { formatElapsed } from './useSetupFlow.js';
import type { SetupFlowView } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

/** How long a plan may go before the screen says GitHub is slow to answer. */
const SLOW_AFTER_MS = 20_000;

/** The kinds whose retry button reads "Choose another name" and returns to the form. */
const NAME_TAKEN_KINDS = new Set(['repository-taken', 'project-taken']);

const MARKS: Record<'running' | 'done' | 'failed', string> = {
  running: '…',
  done: '✓',
  failed: '✗',
};

/**
 * "Checking before anything is created" (architecture document A.7, M9.9):
 * the plan's own checks, shown as they run, under the disabled form. A
 * failure keeps the list and offers to try again or go back; a name already
 * taken offers to choose another name instead.
 */
export function SetupChecking({ view }: Props): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { checks, checkStartedAt, checkStarts, planError } = view;
  const elapsedMs = checkStartedAt === null ? 0 : now - checkStartedAt;
  const slow = planError === null && elapsedMs > SLOW_AFTER_MS;
  const nameTaken = planError !== null && NAME_TAKEN_KINDS.has(planError.kind);

  return (
    <section style={cardStyle} data-testid="setup-checking" aria-labelledby="setup-checking-title">
      <div style={headRowStyle}>
        <h2 id="setup-checking-title" style={titleStyle}>
          Checking before anything is created
        </h2>
        <span style={hintStyle} data-testid="setup-checking-elapsed">
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      <ul style={listStyle} data-testid="setup-checks">
        {checks.map((check) => {
          const running = check.state === 'running';
          const startedAt = checkStarts[check.checkId];
          const ownMs = running && startedAt !== undefined ? now - startedAt : 0;
          return (
            <li
              key={check.checkId}
              data-testid={`setup-check-${check.checkId}`}
              data-state={check.state}
              aria-live={running ? 'polite' : undefined}
            >
              <span aria-hidden="true">{check.state === 'running' ? '…' : MARKS[check.state]}</span>{' '}
              {check.text}
              {running && ownMs >= 1000 && ` (${Math.floor(ownMs / 1000)}s)`}
            </li>
          );
        })}
      </ul>
      {slow && (
        <p style={hintStyle} data-testid="setup-checking-slow">
          GitHub is slow to answer. You can keep waiting or cancel.
        </p>
      )}
      {planError !== null ? (
        <div
          style={failureStyle}
          role="alert"
          data-testid="setup-check-error"
          data-kind={planError.kind}
        >
          <p style={errorAreaStyle}>{planError.message}</p>
          <p style={hintStyle}>Nothing was created.</p>
          <div style={actionsStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              data-testid="setup-check-retry"
              onClick={() => (nameTaken ? view.focusNameAndBackToForm() : void view.showPlan())}
            >
              {nameTaken ? 'Choose another name' : 'Try again'}
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              data-testid="setup-back"
              onClick={view.backToForm}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div style={actionsStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            data-testid="setup-check-cancel"
            onClick={view.cancelCheck}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

const headRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.6rem',
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };
const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  fontSize: '0.85rem',
};
const failureStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};
const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };
