import type { ProjectShape } from '@ai-lore-companion/core';
import type { JSX } from 'react';

/**
 * Header chips for v0.8 Phase A — informational, passive, no click.
 *
 *   - **Lore version chip** — visible whenever the project declares a
 *     `core_version` in `workspace.yaml`. Reads `v{coreVersion}` (e.g.
 *     `v0.5.1`). Hidden for legacy projects with no `core_version` line.
 *   - **Shape chip** — visible **only** when the project declares the
 *     publishing shape (`workspace.yaml` carries a `publish:` block).
 *     Reads `Publishing`. Absent in the default shape — the default is the
 *     absence of news.
 *
 * Both chips read the chain's `coreVersion` + `shape` fields surfaced by
 * `core/chain/reader.ts` (Phase A's chain extension). They render with the
 * same visual language as the existing register chips (posture / dials /
 * focus type) but carry no popover — they are read-only labels.
 */
export function ShapeChips({
  coreVersion,
  shape,
}: {
  /** From the chain payload; `null` when the manifest is missing the field. */
  coreVersion: string | null;
  /** From the chain payload; `'publishing'` when `workspace.yaml` declares it. */
  shape: ProjectShape;
}): JSX.Element | null {
  // Render nothing at all when both chips would hide — keeps the cluster's
  // gap from leaving an empty strip in the header.
  if (!coreVersion && shape !== 'publishing') return null;
  return (
    <div style={clusterStyle} data-testid="shape-chips">
      {coreVersion ? (
        <span style={chipStyle} data-testid="chip-lore-version">
          <span style={labelStyle}>Lore</span>
          <span style={valueStyle}>v{coreVersion}</span>
        </span>
      ) : null}
      {shape === 'publishing' ? (
        <span
          style={{ ...chipStyle, ...publishingChipStyle }}
          data-testid="chip-shape"
        >
          <span style={labelStyle}>Shape</span>
          <span style={valueStyle}>Publishing</span>
        </span>
      ) : null}
    </div>
  );
}

const clusterStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  flexShrink: 0,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  height: '1.55rem',
  padding: '0 0.55rem',
  background: '#1f2933',
  color: '#cbd5dd',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

const labelStyle: React.CSSProperties = {
  color: '#6c7783',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: '0.62rem',
};

const valueStyle: React.CSSProperties = {
  color: '#cbd5dd',
};

const publishingChipStyle: React.CSSProperties = {
  // Subtle accent so the shape chip stands out when present — Publishing
  // is the news, the absence of the chip is the no-news state.
  borderColor: '#3a6da4',
  color: '#a7c3e1',
};
