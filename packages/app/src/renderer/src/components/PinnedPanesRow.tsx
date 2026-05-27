import type { JSX } from 'react';
import { type DriftLevel, driftLevel } from '../store.js';

/** A pinned cockpit pane — the chip data — `id` matches the runtime tab id. */
export type PinnedPane = { id: string; title: string };

type Props = {
  panes: PinnedPane[];
  activeId: string;
  /** Per-pane unacked-drift counts, keyed by pane id. */
  drift?: Record<string, number>;
  onSelect: (id: string) => void;
};

const DRIFT_COLOR: Record<DriftLevel, { bg: string; fg: string }> = {
  idle: { bg: '#1f2933', fg: '#7c8893' },
  live: { bg: '#2c5b3f', fg: '#bcefcd' },
  warn: { bg: '#7a5a14', fg: '#ffdf91' },
  alert: { bg: '#7a1f1f', fg: '#ffc2c2' },
};

/**
 * The pinned-panes navigation row. Sits above the left panel's tab strip.
 * Status / Payload / Memory are navigation surfaces, not documents — they
 * get a chip row of their own so the tab strip below carries only the user's
 * shell / ai / browser tabs.
 */
export function PinnedPanesRow({ panes, activeId, drift, onSelect }: Props): JSX.Element {
  return (
    <div style={rowStyle} data-testid="pinned-panes-row">
      {panes.map((p) => {
        const active = p.id === activeId;
        const count = drift?.[p.id];
        const c = count !== undefined ? DRIFT_COLOR[driftLevel(count)] : null;
        return (
          <button
            key={p.id}
            type="button"
            style={{ ...chipStyle, ...(active ? activeChipStyle : null) }}
            data-testid={`tab-${p.id}`}
            onClick={() => onSelect(p.id)}
          >
            <span style={chipLabelStyle}>{p.title}</span>
            {c ? (
              <span
                style={{ ...chipBadgeStyle, background: c.bg, color: c.fg }}
                aria-label={`${count} changed`}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  background: '#0c121a',
  borderBottom: '1px solid #1f2933',
  padding: '0.35rem 0.5rem',
  flexShrink: 0,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.25rem 0.7rem',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: '999px',
  color: '#8a96a2',
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const activeChipStyle: React.CSSProperties = {
  background: '#1a2230',
  border: '1px solid #2a3a52',
  color: '#e6edf3',
};

const chipLabelStyle: React.CSSProperties = {
  lineHeight: 1,
};

const chipBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: '1.1rem',
  height: '1.05rem',
  padding: '0 0.3rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  fontSize: '0.62rem',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};
