import type { JSX } from 'react';
import type { DriftLevel } from '../store.js';
import { ACTION_BUTTON_HEIGHT } from './ActionButton.js';

const STYLES: Record<DriftLevel, { background: string; color: string; label: string }> = {
  idle: {
    background: 'var(--color-neutral-pill)',
    color: 'var(--color-text-secondary)',
    label: 'idle',
  },
  live: { background: 'var(--color-success-bg)', color: 'var(--color-success-fg)', label: 'live' },
  warn: { background: 'var(--color-warn-bg)', color: 'var(--color-warn-fg)', label: 'warn' },
  alert: {
    background: 'var(--color-danger-bg)',
    color: 'var(--color-danger-fg-light)',
    label: 'alert',
  },
};

export function DriftPill({ level, count }: { level: DriftLevel; count: number }): JSX.Element {
  const style = STYLES[level];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        height: ACTION_BUTTON_HEIGHT,
        padding: '0 0.75rem',
        borderRadius: '999px',
        fontSize: '0.78rem',
        fontWeight: 600,
        lineHeight: 1,
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
