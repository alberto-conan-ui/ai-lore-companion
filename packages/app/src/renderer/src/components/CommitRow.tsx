import type { JSX, ReactNode } from 'react';

/**
 * One commit row, shared by the global baseline picker and the in-editor diff's
 * per-file history column (Read-only IDE). A **save-point** shows a gold ★, an
 * **ack** a blue •; then the label, the short SHA, and the date — one visual
 * language for "pick a milestone" everywhere. Callers pass an optional
 * `children` for a sub-line (the picker's rolled-up bound ack).
 */

export type CommitKind = 'save-point' | 'ack';

/** First 7 chars — the git short-SHA convention. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Epoch **seconds** → a compact local date + time. `0` (unknown) renders blank. */
export function formatStamp(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CommitRow({
  kind,
  label,
  sha,
  timestamp,
  active,
  onClick,
  disabled,
  testId,
  children,
}: {
  kind: CommitKind;
  label: string;
  sha: string;
  /** Epoch **seconds**. */
  timestamp: number;
  active: boolean;
  onClick: () => void;
  /** Render as a non-clickable, dimmed reference label (e.g. a save-point that
   *  didn't touch the current file). */
  disabled?: boolean;
  testId?: string;
  /** Optional sub-line beneath the main row (e.g. a rolled-up bound ack). */
  children?: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        ...rowStyle,
        ...(active ? rowActiveStyle : null),
        ...(disabled ? rowDisabledStyle : null),
      }}
      data-testid={testId}
      aria-current={active}
      onClick={disabled ? undefined : onClick}
    >
      <span style={badgeStyle(kind)}>{kind === 'save-point' ? '★' : '•'}</span>
      <span style={rowMainStyle}>
        <span style={rowTopStyle}>
          <span style={rowLabelStyle}>{label}</span>
          {sha ? <span style={rowShaStyle}>{shortSha(sha)}</span> : null}
          <span style={rowDateStyle}>{formatStamp(timestamp)}</span>
        </span>
        {children}
      </span>
    </button>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.5rem',
  width: '100%',
  padding: '0.35rem 0.5rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.74rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const rowActiveStyle: React.CSSProperties = { background: 'var(--color-row-active)' };

/** A non-clickable reference label (a save-point that didn't touch this file). */
const rowDisabledStyle: React.CSSProperties = { opacity: 0.5, cursor: 'default' };

function badgeStyle(kind: CommitKind): React.CSSProperties {
  return {
    flex: 'none',
    lineHeight: '1.3rem',
    color: kind === 'save-point' ? 'var(--color-amber)' : 'var(--color-accent-soft)',
  };
}

const rowMainStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
};

const rowTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
};

const rowLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowShaStyle: React.CSSProperties = {
  flex: 'none',
  color: 'var(--color-text-soft)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.66rem',
};

const rowDateStyle: React.CSSProperties = {
  flex: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '0.68rem',
};
