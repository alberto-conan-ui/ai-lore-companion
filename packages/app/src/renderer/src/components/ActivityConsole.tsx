import { type JSX, useEffect, useRef, useState } from 'react';
import {
  type ActivityEntry,
  type ActivityKind,
  clearActivity,
  getActivity,
  subscribeActivity,
} from './activityLog.js';

/**
 * The in-app assistant **activity console** (HL, 2026-06-03) — a docked,
 * copy-pasteable feed of everything the read-only assistant does, for **both
 * engines**. Every turn fired, every status change, every raw answer, and every
 * error lands here, so the HL can see what's happening live and paste a raw
 * response or error straight back instead of digging in a terminal. Collapsed by
 * default; auto-opens on an error and badges the error count.
 */

const KIND_STYLE: Record<ActivityKind, { glyph: string; color: string }> = {
  turn: { glyph: '→', color: '#9fd0e8' },
  status: { glyph: '·', color: '#6b7785' },
  answer: { glyph: '←', color: '#86d9a0' },
  error: { glyph: '✕', color: '#e08a6a' },
};

function copy(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/** `dock` — a collapsed bottom bar; `full` — fills its pane as the primary
 *  console (the mid-pane Assistant tab), always open and auto-scrolling. */
export function ActivityConsole({ variant = 'dock' }: { variant?: 'dock' | 'full' }): JSX.Element {
  const full = variant === 'full';
  const [, bump] = useState(0);
  const [open, setOpen] = useState(full);
  const lastErrId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeActivity(() => bump((n) => n + 1)), []);

  const entries = getActivity();
  const last = entries[entries.length - 1];
  const errors = entries.filter((e) => e.kind === 'error').length;
  const showBody = open || full;

  // auto-open the dock on a new error; in either mode, keep the latest in view
  useEffect(() => {
    const lastErr = [...entries].reverse().find((e) => e.kind === 'error');
    if (lastErr && lastErr.id !== lastErrId.current) {
      lastErrId.current = lastErr.id;
      if (!full) setOpen(true);
    }
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  });

  const summary = last
    ? `${KIND_STYLE[last.kind].glyph} ${last.text}`
    : 'Assistant idle — nothing run yet.';

  return (
    <div style={full ? fullWrapStyle : wrapStyle} data-testid="activity-console">
      <button
        type="button"
        style={headStyle}
        onClick={() => !full && setOpen((o) => !o)}
        aria-expanded={showBody}
        data-testid="activity-toggle"
      >
        {full ? null : (
          <span style={{ ...chevStyle, transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
        )}
        <span style={headLabelStyle}>Activity</span>
        {errors > 0 ? <span style={errBadgeStyle}>{errors}</span> : null}
        {full ? null : (
          <span style={{ ...summaryStyle, color: last ? KIND_STYLE[last.kind].color : '#6b7785' }}>
            {summary}
          </span>
        )}
        {full ? <span style={{ flex: 1 }} /> : null}
        {entries.length > 0 ? (
          <span
            style={clearStyle}
            onClick={(e) => {
              e.stopPropagation();
              clearActivity();
            }}
            data-testid="activity-clear"
          >
            clear
          </span>
        ) : null}
      </button>
      {showBody ? (
        <div style={full ? fullBodyStyle : bodyStyle} data-testid="activity-body" ref={bodyRef}>
          {entries.length === 0 ? (
            <div style={emptyStyle}>
              No activity yet — connect the assistant and hit Refresh on the left.
            </div>
          ) : (
            entries.map((e) => <Row key={e.id} e={e} />)
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({ e }: { e: ActivityEntry }): JSX.Element {
  const [show, setShow] = useState(false);
  const k = KIND_STYLE[e.kind];
  return (
    <div style={rowStyle}>
      <span style={timeStyle}>{e.at}</span>
      <span style={{ ...glyphStyle, color: k.color }}>{k.glyph}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...rowTextStyle, color: e.kind === 'error' ? k.color : '#cdd6df' }}>
          {e.text}
          {e.detail ? (
            <>
              {' '}
              <button type="button" style={miniBtnStyle} onClick={() => setShow((s) => !s)}>
                {show ? 'hide' : 'view'}
              </button>
              <button
                type="button"
                style={miniBtnStyle}
                onClick={() => copy(e.detail ?? '')}
                data-testid="activity-copy"
              >
                copy
              </button>
            </>
          ) : null}
        </div>
        {show && e.detail ? <pre style={preStyle}>{e.detail}</pre> : null}
      </div>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  flexShrink: 0,
  borderTop: '1px solid #161e29',
  background: '#0c121b',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};
const fullWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#0c121b',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};
const fullBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 0 10px',
  borderTop: '1px solid #141c27',
};
const headStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: 'none',
  border: 0,
  cursor: 'pointer',
  textAlign: 'left',
};
const chevStyle: React.CSSProperties = {
  color: '#6b7785',
  fontSize: '0.9rem',
  transition: 'transform .2s',
};
const headLabelStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#8b96a2',
};
const errBadgeStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  color: '#1a0f0c',
  background: '#e08a6a',
  borderRadius: 999,
  padding: '1px 6px',
  fontWeight: 700,
};
const summaryStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '0.64rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const clearStyle: React.CSSProperties = { fontSize: '0.6rem', color: '#5a6571' };
const bodyStyle: React.CSSProperties = {
  maxHeight: 200,
  overflowY: 'auto',
  padding: '4px 0 8px',
  borderTop: '1px solid #141c27',
};
const emptyStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '0.64rem',
  color: '#5a6571',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '3px 12px',
};
const timeStyle: React.CSSProperties = {
  color: '#4a5562',
  fontSize: '0.6rem',
  paddingTop: 1,
  flexShrink: 0,
};
const glyphStyle: React.CSSProperties = { fontSize: '0.7rem', paddingTop: 1, flexShrink: 0 };
const rowTextStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};
const miniBtnStyle: React.CSSProperties = {
  background: '#16202d',
  border: '1px solid #233040',
  borderRadius: 4,
  color: '#9fb2c4',
  fontSize: '0.56rem',
  padding: '0 5px',
  marginLeft: 4,
  cursor: 'pointer',
};
const preStyle: React.CSSProperties = {
  margin: '5px 0 2px',
  padding: '8px 10px',
  background: '#070b11',
  border: '1px solid #1a2430',
  borderRadius: 6,
  color: '#aeb9c4',
  fontSize: '0.62rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 260,
  overflowY: 'auto',
};
