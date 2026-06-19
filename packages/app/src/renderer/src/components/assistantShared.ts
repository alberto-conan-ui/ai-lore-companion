import type { EngineEntry } from '@ai-lore-companion/core';
import type { HelperPhase } from '../../../shared/ipc.js';

/**
 * Shared helpers + styles for the two AI-assistant surfaces (AI Helper, CR9).
 * The v1.0 vision splits the helper into two tabs that ride the **same**
 * Channel-C event stream (`onHelperEvent`, one session per window):
 *   - {@link ./AssistantHost.tsx} — the **mid-pane host**: Connect, the engine
 *     pick, and the live session (Claude's visible PTY or a Gemini headless
 *     indicator). This is where the user *starts* the assistant.
 *   - {@link ./AssistantFeed.tsx} — the **left-pane output**: the read-only
 *     answers, driven only by clicking AI-assisted places (no typing).
 * Each subscribes to Channel C independently, so they derive connected/busy from
 * the same phase the same way — hence these shared predicates.
 */

/** The engines the read-only assistant can run on (CR7) — only Claude and
 *  Gemini are helper-capable; other registered engines aren't offered. */
export function isHelperCapable(engine: EngineEntry): boolean {
  const base = engine.binary.split('/').pop() ?? engine.binary;
  return base === 'claude' || base === 'gemini';
}

/** Connected once the session is live. A visible engine (Claude) signals this
 *  with its terminal id; a headless engine (Gemini) has none, so any working
 *  phase means connected. */
export function isConnected(phase: HelperPhase | null, ptyId: string | null): boolean {
  return ptyId !== null || phase === 'ready' || phase === 'thinking' || phase === 'answered';
}

/** No turn can be driven while connecting or thinking. */
export function isBusy(phase: HelperPhase | null): boolean {
  return phase === 'connecting' || phase === 'thinking';
}

/** The human status line for each phase. */
export function statusLabel(phase: HelperPhase | null, connected: boolean): string {
  switch (phase) {
    case 'connecting':
      return 'Connecting the assistant…';
    case 'ready':
      return 'Ready.';
    case 'thinking':
      return 'Thinking…';
    case 'answered':
      return 'Answered.';
    case 'error':
      return '';
    default:
      return connected ? '' : 'Not connected.';
  }
}

export const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
};

export const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  background: 'var(--color-panel)',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

export const headerLabelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: 'var(--color-text-bright)',
};

export const headerHintStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
};

export const engineSelectStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0.15rem 0.3rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-bubble-border)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.72rem',
};

export const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.7rem',
  padding: '0.6rem 0.7rem',
  flexShrink: 0,
  flexWrap: 'wrap',
};

export const buttonStyle: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  background: 'var(--color-bubble)',
  border: '1px solid var(--color-bubble-border)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const buttonBusyStyle: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'default',
};

export const statusStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-soft)',
};

export const errorStyle: React.CSSProperties = {
  margin: '0 0.7rem 0.4rem',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--color-danger-fg)',
  whiteSpace: 'pre-wrap',
};

export const sessionWrapStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  borderTop: '1px solid var(--color-border)',
};

export const hintStyle: React.CSSProperties = {
  margin: 'auto',
  maxWidth: '22rem',
  padding: '1rem',
  fontSize: '0.82rem',
  lineHeight: 1.5,
  color: 'var(--color-text-muted)',
  textAlign: 'center',
};
