import type { JSX } from 'react';

/**
 * Placeholder body for a `kind: 'ai'` tab. Phase A wires the tab discriminator
 * and stores the chosen engine; the real surface (a centred Start button with
 * an engine picker, then a two-column prompts/PTY layout) lands in Phase B and
 * Phase C.
 */
export function AiTab({ engine }: { engine: string }): JSX.Element {
  const label = engine || 'unset';
  return (
    <div style={wrapStyle} data-testid="ai-tab" data-ai-engine={label}>
      <div style={cardStyle}>
        <div style={glyphStyle}>✦</div>
        <div style={titleStyle}>{label} · empty session</div>
        <div style={hintStyle}>Start button + prompts catalog land in v0.7 Phase B / C.</div>
      </div>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0a0f17',
  color: '#dde3ea',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.5rem',
  textAlign: 'center',
};

const glyphStyle: React.CSSProperties = {
  fontSize: '2rem',
  lineHeight: 1,
  color: '#c7b3ff',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#6c7783',
};
