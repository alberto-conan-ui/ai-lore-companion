import { type JSX, useEffect, useState } from 'react';
import type { HelperAction, HelperPhase } from '../../../shared/ipc.js';
import {
  answerStyle,
  buttonBusyStyle,
  buttonStyle,
  controlsStyle,
  errorStyle,
  headerHintStyle,
  headerLabelStyle,
  headerStyle,
  hintStyle,
  isBusy,
  isConnected,
  paneStyle,
  sessionWrapStyle,
  statusLabel,
  statusStyle,
} from './assistantShared.js';

/**
 * The AI-assistant **output** surface (AI Helper, CR9) — the left-pane tab where
 * the read-only helper's answers render. The user drives the assistant **only by
 * clicking** the AI-assisted actions here (no typing — focus "Open questions —
 * RESOLVED"); each click fires a read-only turn into the session hosted by the
 * mid-pane {@link ./AssistantHost.tsx}, and the answer comes back here over the
 * same Channel-C stream (works for both Claude and Gemini — both carry the
 * answer text on the `answered` event).
 *
 * It owns no session: until the assistant is connected (started in the host
 * tab), the actions are disabled and the surface shows a "start it" empty state.
 * That gate is the opt-in: connecting the assistant is what enables the
 * AI-assisted places. CR9 Phase 2 turns the single latest answer into a feed;
 * Phase 3 surfaces more places across the app.
 */
export function AssistantFeed(): JSX.Element {
  const [phase, setPhase] = useState<HelperPhase | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    return window.cockpit.onHelperEvent((event) => {
      setPhase(event.phase);
      if (event.ptyId) setPtyId(event.ptyId);
      if (event.phase === 'answered' && event.answer) setAnswer(event.answer);
      setError(event.phase === 'error' ? (event.error ?? 'Something went wrong.') : '');
    });
  }, []);

  const connected = isConnected(phase, ptyId);
  const busy = isBusy(phase);

  const onAsk = (action: HelperAction): void => {
    if (!connected || busy) return;
    setError('');
    void window.cockpit.helperAsk(action);
  };

  return (
    <div style={paneStyle} data-testid="pane-assistant" data-pane="assistant">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>Assistant</span>
        <span style={headerHintStyle}>read-only answers</span>
      </div>

      <div style={controlsStyle}>
        <button
          type="button"
          style={{ ...buttonStyle, ...(!connected || busy ? buttonBusyStyle : null) }}
          onClick={() => onAsk('summarize-pending')}
          disabled={!connected || busy}
          data-testid="assistant-ask"
        >
          Summarize what's pending
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, ...(!connected || busy ? buttonBusyStyle : null) }}
          onClick={() => onAsk('what-changed')}
          disabled={!connected || busy}
          data-testid="assistant-what-changed"
        >
          What changed
        </button>
        <span style={statusStyle} data-testid="assistant-status">
          {statusLabel(phase, connected)}
        </span>
      </div>

      {error ? (
        <div style={errorStyle} data-testid="assistant-error">
          {error}
        </div>
      ) : null}

      <div style={sessionWrapStyle}>
        {answer ? (
          <div style={answerStyle} data-testid="assistant-answer">
            {answer}
          </div>
        ) : (
          <div style={hintStyle} data-testid="assistant-hint">
            {connected
              ? 'Click an action above — the assistant reads this project and answers here.'
              : 'Start the assistant in the Assistant tab (mid pane) to enable AI help here.'}
          </div>
        )}
      </div>
    </div>
  );
}
