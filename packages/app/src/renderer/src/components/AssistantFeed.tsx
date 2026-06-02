import { type JSX, useEffect, useRef, useState } from 'react';
import type { HelperAction, HelperPhase } from '../../../shared/ipc.js';
import {
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
 * AI-assisted places.
 *
 * CR9 Phase 2: answers accumulate into a **running feed** (newest first) rather
 * than replacing the last one, so the session's answers stay scrollable. The
 * feed resets when a new session connects. Phase 3 surfaces more places.
 */

type FeedEntry = { id: number; label: string; text: string };

/** The label a clicked action carries into the feed. The auto-fired orient
 *  (host-initiated, CR4) has no pending label → it shows as "Orientation". */
const ACTION_LABEL: Record<HelperAction, string> = {
  orient: 'Orientation',
  'summarize-pending': "What's pending",
  'what-changed': 'What changed',
};

export function AssistantFeed(): JSX.Element {
  const [phase, setPhase] = useState<HelperPhase | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [error, setError] = useState<string>('');
  // The label for the turn currently in flight that *this* surface fired. The
  // host's auto-orient leaves it null → the answer lands labelled "Orientation".
  const pendingLabel = useRef<string | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    return window.cockpit.onHelperEvent((event) => {
      setPhase(event.phase);
      if (event.ptyId) setPtyId(event.ptyId);
      // A new session is starting — clear the previous session's feed.
      if (event.phase === 'connecting') {
        setEntries([]);
        pendingLabel.current = null;
      }
      if (event.phase === 'answered' && event.answer) {
        const label = pendingLabel.current ?? ACTION_LABEL.orient;
        pendingLabel.current = null;
        const text = event.answer;
        setEntries((prev) => [{ id: nextId.current++, label, text }, ...prev]);
      }
      if (event.phase === 'error') {
        pendingLabel.current = null;
        setError(event.error ?? 'Something went wrong.');
      } else {
        setError('');
      }
    });
  }, []);

  const connected = isConnected(phase, ptyId);
  const busy = isBusy(phase);

  const onAsk = (action: HelperAction): void => {
    if (!connected || busy) return;
    setError('');
    pendingLabel.current = ACTION_LABEL[action];
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

      <div style={feedWrapStyle} data-testid="assistant-feed">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <div key={entry.id} style={feedEntryStyle} data-testid="assistant-answer">
              <div style={feedLabelStyle}>{entry.label}</div>
              <div style={feedTextStyle}>{entry.text}</div>
            </div>
          ))
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

const feedWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.7rem',
  borderTop: '1px solid #1f2933',
};

const feedEntryStyle: React.CSSProperties = {
  border: '1px solid #1f2933',
  borderRadius: '6px',
  background: '#0c121a',
  padding: '0.6rem 0.7rem',
  flexShrink: 0,
};

const feedLabelStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#6c7783',
  marginBottom: '0.35rem',
};

const feedTextStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  lineHeight: 1.6,
  color: '#dde3ea',
  whiteSpace: 'pre-wrap',
};
