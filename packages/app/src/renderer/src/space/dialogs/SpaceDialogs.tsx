import type { JSX } from 'react';
import type { PendingDialog } from '../../../../shared/ipc.js';
import { secondaryButtonStyle } from '../styles.js';
import { GateDialog } from './GateDialog.js';
import { WritingDialog } from './WritingDialog.js';
import { askerWords } from './dialogParts.js';
import { useDialogQueue } from './useDialogQueue.js';

/** A pending request in one line of the list. */
function requestLine(request: PendingDialog): string {
  const who = askerWords(request.session);
  if (request.kind === 'writing') {
    return `Enter Writing: ${who} asks for ${request.targets.join(', ')}.`;
  }
  return `Gate: ${who} asks at the step ${request.step} of the process ${request.process}.`;
}

/**
 * The two dialogs a session asks for, mounted once by the Space window: the
 * entering-Writing dialog and the gate dialog. Phase M4.5.
 *
 * While a request waits, a list above the bottom edge of the window shows every
 * pending request with its count, and an Open action for each. The list is a
 * polite live region: a screen reader announces a new request, and nothing
 * takes the focus. The oldest request opens its dialog on its own once no key
 * was pressed for a moment (`useDialogQueue`), so a keystroke meant for a
 * terminal does not land in the dialog. Closing a dialog, with Escape or its
 * Close action, answers nothing: the request stays in the list.
 */
export function SpaceDialogs(): JSX.Element | null {
  const queue = useDialogQueue();
  const { requests, open, settled } = queue;
  if (requests.length === 0 && settled === null && queue.error === null) return null;

  return (
    <>
      <section
        style={barStyle}
        aria-label="Requests from sessions"
        aria-live="polite"
        data-testid="dialog-requests"
      >
        {requests.length > 0 ? (
          <>
            <p style={barHeadingStyle} data-testid="dialog-requests-count">
              {requests.length === 1
                ? '1 request waits for your answer.'
                : `${requests.length} requests wait for your answer.`}
            </p>
            <ul style={listStyle}>
              {requests.map((request) => (
                <li key={request.ticket} style={itemStyle}>
                  <span style={lineStyle}>{requestLine(request)}</span>
                  <button
                    type="button"
                    style={openButtonStyle}
                    onClick={() => queue.show(request.ticket)}
                    disabled={open?.ticket === request.ticket}
                    data-testid={`dialog-request-open-${request.ticket}`}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {settled !== null ? (
          <p style={settledStyle} data-testid="dialog-last-settled">
            {settled.outcome === 'cancelled' ? 'A request ended without an answer: ' : ''}
            {settled.message}
          </p>
        ) : null}
        {queue.error !== null ? (
          <p style={settledStyle} role="alert">
            The requests could not be read: {queue.error}
          </p>
        ) : null}
      </section>
      {open?.kind === 'writing' ? (
        <WritingDialog
          key={open.ticket}
          request={open}
          position={queue.position}
          count={requests.length}
          onClose={queue.close}
        />
      ) : null}
      {open?.kind === 'gate' ? (
        <GateDialog
          key={open.ticket}
          request={open}
          position={queue.position}
          count={requests.length}
          onClose={queue.close}
        />
      ) : null}
    </>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.4rem 0.75rem',
  borderTop: '1px solid var(--color-amber-tag-border)',
  background: 'var(--color-amber-tag-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
};

const barHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: 'var(--color-amber-tag-fg)',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const itemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem' };

const lineStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const openButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.15rem 0.6rem',
  fontSize: '0.8rem',
};

const settledStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-secondary)',
};
