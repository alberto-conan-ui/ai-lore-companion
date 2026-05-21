import type { JSX } from 'react';
import type { DriftLevel } from '../store.js';

const STYLES: Record<DriftLevel, { background: string; color: string; label: string }> = {
  idle: { background: '#2d3a44', color: '#9fb1bd', label: 'idle' },
  live: { background: '#2c5b3f', color: '#bcefcd', label: 'live' },
  warn: { background: '#7a5a14', color: '#ffdf91', label: 'warn' },
  alert: { background: '#7a1f1f', color: '#ffc2c2', label: 'alert' },
};

export function DriftPill({ level, count }: { level: DriftLevel; count: number }): JSX.Element {
  const style = STYLES[level];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.78rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: style.background,
        color: style.color,
      }}
      aria-label={`drift ${style.label}, ${count} unacked`}
    >
      <span>{style.label}</span>
      <span style={{ opacity: 0.85 }}>{count}</span>
    </span>
  );
}
