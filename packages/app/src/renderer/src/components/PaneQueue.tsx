import type { QueueEntry } from '@ai-lore-companion/core';
import type { JSX } from 'react';

type Props = {
  label: string;
  entries: QueueEntry[];
  onRowClick: (entry: QueueEntry) => void;
  onRowDoubleClick: (entry: QueueEntry) => void;
  onAck: (id: string) => void;
  onAckAll: () => void;
};

const TYPE_GLYPH: Record<QueueEntry['type'], { glyph: string; color: string }> = {
  add: { glyph: '+', color: '#7fc97f' },
  change: { glyph: '~', color: '#ffb84d' },
  unlink: { glyph: '−', color: '#ff6b6b' },
  'tracker-review': { glyph: '▸', color: '#c599ff' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function PaneQueue({
  label,
  entries,
  onRowClick,
  onRowDoubleClick,
  onAck,
  onAckAll,
}: Props): JSX.Element {
  return (
    <section style={containerStyle} data-testid={`queue-${label.toLowerCase()}`}>
      <header style={headerStyle}>
        <span style={labelStyle}>{label} queue</span>
        <span style={countStyle}>{entries.length}</span>
        <button
          type="button"
          onClick={onAckAll}
          disabled={entries.length === 0}
          style={{ ...ackAllBtn, ...(entries.length === 0 ? ackAllBtnDisabled : null) }}
        >
          Ack all
        </button>
      </header>
      {entries.length === 0 ? (
        <div style={emptyStyle}>Drift is acked.</div>
      ) : (
        <div style={listStyle}>
          {entries.map((entry) => {
            const t = TYPE_GLYPH[entry.type];
            const primary = entry.subject ? entry.subject.title : basename(entry.path);
            const secondary = entry.subject ? entry.path : dirname(entry.path);
            return (
              <button
                type="button"
                key={entry.id}
                style={rowStyle}
                onClick={() => onRowClick(entry)}
                onDoubleClick={() => onRowDoubleClick(entry)}
              >
                <span style={{ ...glyphStyle, color: t.color }}>{t.glyph}</span>
                <span style={pathColStyle}>
                  <span style={primaryStyle}>{primary}</span>
                  <span style={secondaryStyle}>{secondary}</span>
                </span>
                <span style={timeStyle}>{formatTime(entry.ts)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAck(entry.id);
                  }}
                  style={ackBtn}
                >
                  ack
                </button>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  borderTop: '1px solid #1f2933',
  background: '#0c121a',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  borderBottom: '1px solid #1f2933',
  background: '#0f1620',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: '#dde3ea',
  textTransform: 'uppercase',
};

const countStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#9fb1bd',
  background: '#1f2933',
  padding: '0.05rem 0.35rem',
  borderRadius: '999px',
};

const ackAllBtn: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0.18rem 0.55rem',
  background: '#3a78c2',
  color: '#ffffff',
  border: 'none',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const ackAllBtnDisabled: React.CSSProperties = {
  background: '#2a323a',
  color: '#7a8590',
  cursor: 'default',
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  width: '100%',
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid #161c25',
  textAlign: 'left',
  font: 'inherit',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.78rem',
  cursor: 'pointer',
  color: '#dde3ea',
};

const glyphStyle: React.CSSProperties = {
  width: '1rem',
  textAlign: 'center',
  fontWeight: 700,
};

const pathColStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const primaryStyle: React.CSSProperties = {
  color: '#dde3ea',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const secondaryStyle: React.CSSProperties = {
  color: '#5f6973',
  fontSize: '0.7rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const timeStyle: React.CSSProperties = {
  color: '#6c7783',
  fontSize: '0.72rem',
  minWidth: '4.5rem',
  textAlign: 'right',
};

const ackBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2f3a45',
  color: '#aab4be',
  borderRadius: '4px',
  padding: '0.1rem 0.45rem',
  fontSize: '0.7rem',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6c7783',
  fontSize: '0.82rem',
};
