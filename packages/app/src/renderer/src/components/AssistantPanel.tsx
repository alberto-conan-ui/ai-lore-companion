import { type FormEvent, type JSX, useEffect, useRef, useState } from 'react';
import type { HelperAction, HelperPhase } from '../../../shared/ipc.js';
import { HelperTerminal } from './HelperTerminal.js';

/**
 * The AI-assistant panel (AI Helper, CR2) — a **visible, app-driven, read-only**
 * `claude` session. The user clicks **Connect Assistant**; the app launches
 * `claude` in a read-only terminal (deny-writes profile) right here, so the
 * whole conversation is on screen; the canned actions inject turns into that
 * session; the terminal is input-locked, so only the app drives it.
 *
 * Everything is event-driven: Connect / actions fire IPC, and the phase + the
 * helper's PTY id arrive over `onHelperEvent` (Channel C). The full restructure
 * of the left pane is CR8.
 */
export function AssistantPanel({ active }: { active: boolean }): JSX.Element {
  const [phase, setPhase] = useState<HelperPhase | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [text, setText] = useState<string>('');
  // Fire the one-time orient turn the first time the session reports ready.
  const orientedRef = useRef(false);

  useEffect(() => {
    return window.cockpit.onHelperEvent((event) => {
      setPhase(event.phase);
      if (event.ptyId) setPtyId(event.ptyId);
      setError(event.phase === 'error' ? (event.error ?? 'Something went wrong.') : '');
      // Always orient first: the moment the session is ready, drive an orient
      // turn before the user asks anything, so every answer is grounded in the
      // methodology + focus chain. Once per connected session.
      if (event.phase === 'ready' && !orientedRef.current) {
        orientedRef.current = true;
        void window.cockpit.helperAsk('orient');
      }
    });
  }, []);

  // Connected once the helper's terminal id has arrived (the `connecting` event).
  const connected = ptyId !== null;
  // No turn can be driven while connecting or thinking.
  const busy = phase === 'connecting' || phase === 'thinking';

  const onConnect = (): void => {
    setError('');
    setPhase('connecting');
    void window.cockpit.helperConnect();
  };

  const onAsk = (action: HelperAction): void => {
    setError('');
    void window.cockpit.helperAsk(action);
  };

  const onAskText = (e: FormEvent): void => {
    e.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    setError('');
    void window.cockpit.helperAskText(question);
    setText('');
  };

  return (
    <div style={paneStyle} data-testid="pane-assistant" data-pane="assistant">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>Assistant</span>
        <span style={headerHintStyle}>read-only · you watch, the app drives</span>
      </div>

      <div style={controlsStyle}>
        {connected ? (
          <>
            <button
              type="button"
              style={{ ...buttonStyle, ...(busy ? buttonBusyStyle : null) }}
              onClick={() => onAsk('summarize-pending')}
              disabled={busy}
              data-testid="assistant-ask"
            >
              Summarize what's pending
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, ...(busy ? buttonBusyStyle : null) }}
              onClick={() => onAsk('what-changed')}
              disabled={busy}
              data-testid="assistant-what-changed"
            >
              What changed
            </button>
          </>
        ) : (
          <button
            type="button"
            style={{ ...buttonStyle, ...(phase === 'connecting' ? buttonBusyStyle : null) }}
            onClick={onConnect}
            disabled={phase === 'connecting'}
            data-testid="assistant-connect"
          >
            Connect Assistant
          </button>
        )}
        <span style={statusStyle} data-testid="assistant-status">
          {statusLabel(phase, connected)}
        </span>
      </div>

      {connected ? (
        <form style={askRowStyle} onSubmit={onAskText} data-testid="assistant-ask-form">
          <input
            type="text"
            style={inputStyle}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder="Ask a read-only question…"
            data-testid="assistant-input"
          />
          <button
            type="submit"
            style={{ ...buttonStyle, ...(busy || !text.trim() ? buttonBusyStyle : null) }}
            disabled={busy || !text.trim()}
            data-testid="assistant-send"
          >
            Send
          </button>
        </form>
      ) : null}

      {error ? (
        <div style={errorStyle} data-testid="assistant-error">
          {error}
        </div>
      ) : null}

      <div style={sessionWrapStyle}>
        {connected && ptyId ? (
          <HelperTerminal ptyId={ptyId} active={active} />
        ) : (
          <div style={hintStyle} data-testid="assistant-hint">
            Connect a read-only assistant to watch it read this project and answer your questions.
          </div>
        )}
      </div>
    </div>
  );
}

/** The human status line for each phase. */
function statusLabel(phase: HelperPhase | null, connected: boolean): string {
  switch (phase) {
    case 'connecting':
      return 'Connecting the assistant…';
    case 'ready':
      return 'Ready — ask away.';
    case 'thinking':
      return 'Thinking…';
    case 'answered':
      return 'Answered (above).';
    case 'error':
      return '';
    default:
      return connected ? '' : 'Not connected.';
  }
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: '#0a0f17',
  color: '#dde3ea',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  background: '#0c121a',
  borderBottom: '1px solid #1f2933',
  flexShrink: 0,
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#e6edf3',
};

const headerHintStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#6c7783',
  fontStyle: 'italic',
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.7rem',
  padding: '0.6rem 0.7rem',
  flexShrink: 0,
};

const buttonStyle: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  background: '#1b2a3d',
  border: '1px solid #2c4055',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonBusyStyle: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'default',
};

const askRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0 0.7rem 0.6rem',
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '0.4rem 0.6rem',
  background: '#0c121a',
  border: '1px solid #1f2933',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.8rem',
};

const statusStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#7a8590',
};

const errorStyle: React.CSSProperties = {
  margin: '0 0.7rem 0.4rem',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: '#ff8a8a',
  whiteSpace: 'pre-wrap',
};

const sessionWrapStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  borderTop: '1px solid #1f2933',
};

const hintStyle: React.CSSProperties = {
  margin: 'auto',
  maxWidth: '22rem',
  padding: '1rem',
  fontSize: '0.82rem',
  lineHeight: 1.5,
  color: '#6c7783',
  textAlign: 'center',
};
