import React, { type CSSProperties } from 'react';

export type StageShape = 'build' | 'spec' | 'queued' | 'dormant';

export function StageMark({ shape, word }: { shape: StageShape; word: string }) {
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
  } else if (shape === 'dormant') {
    // The spec says: dashed 1px border dormant.
    shapeStyle = { ...shapeStyle, border: '1px dashed currentColor' };
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span style={shapeStyle} aria-hidden="true" />
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
}) {
  const colorMap = {
    accent: 'var(--d-accent)',
    red: 'var(--d-red)',
    muted: 'var(--d-muted)',
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span
        style={{
          display: 'inline-block',
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: colorMap[tone],
          marginRight: '6px',
        }}
        aria-hidden="true"
      />
      {mark && <span style={{ marginRight: '4px', color: colorMap[tone] }}>{mark}</span>}
      <span style={{ color: colorMap[tone] }}>{word}</span>
    </span>
  );
}
