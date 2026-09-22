import type { CSSProperties, JSX } from 'react';

export type StageShape = 'build' | 'spec' | 'queued' | 'dormant';

export function StageMark({ shape, word }: { shape: StageShape; word: string }): JSX.Element {
  let shapeStyle: CSSProperties = {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    marginRight: '6px',
  };
  if (shape === 'build') {
    shapeStyle = { ...shapeStyle, background: 'currentColor' };
  } else if (shape === 'spec') {
    shapeStyle = { ...shapeStyle, border: '1px solid currentColor', transform: 'rotate(45deg)' };
  } else if (shape === 'queued') {
    shapeStyle = { ...shapeStyle, border: '1px solid currentColor', borderRadius: '50%' };
  } else {
    shapeStyle = { ...shapeStyle, border: '1px dashed currentColor' };
  }
  return (
    <span className="dashboard-v2-stage-mark">
      <span className={`dashboard-v2-stage-mark-${shape}`} style={shapeStyle} aria-hidden="true" />
      <span>{word}</span>
    </span>
  );
}

export function StatusDot({
  tone,
  word,
  mark,
}: {
  tone: 'accent' | 'red' | 'muted';
  word: string;
  mark?: string;
}): JSX.Element {
  const color =
    tone === 'accent' ? 'var(--d-accent)' : tone === 'red' ? 'var(--d-red)' : 'var(--d-muted)';
  return (
    <span className="dashboard-v2-status-dot">
      <span
        style={{
          display: 'inline-block',
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: color,
          marginRight: '6px',
        }}
        aria-hidden="true"
      />
      {mark === undefined ? null : <span style={{ marginRight: '4px' }}>{mark}</span>}
      <span style={{ color }}>{word}</span>
    </span>
  );
}
