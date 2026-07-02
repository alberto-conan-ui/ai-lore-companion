import type { BranchResult } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { useCockpitStore } from '../store.js';

/**
 * The header's two branch indicators — the payload repo and the lore repo,
 * read-only (P5 chrome). Main pushes `onBranches` on seed, on `.git/logs/HEAD`
 * changes (commit *and* checkout), and on window focus, so a branch switch in
 * either repo shows here without a reload.
 *
 * Detached HEAD and failed reads are rendered as explicit states — never a
 * fake branch name (the `BranchResult` contract; the full branch-aware SP/ACK
 * model is parked with AI-Lore core, so this header stays a plain read).
 */
export function BranchIndicators(): JSX.Element | null {
  const branches = useCockpitStore((s) => s.branches);
  if (!branches) return null;
  return (
    <div style={clusterStyle} data-testid="branch-indicators">
      <BranchChip scope="payload" info={branches.payload} />
      <BranchChip scope="lore" info={branches.lore} />
    </div>
  );
}

function BranchChip({
  scope,
  info,
}: {
  scope: 'payload' | 'lore';
  info: BranchResult;
}): JSX.Element {
  const state = info.kind === 'failed' ? 'failed' : info.detached ? 'detached' : 'ok';
  const value = state === 'ok' ? (info as { branch: string }).branch : state;
  const title =
    info.kind === 'failed'
      ? `${scope} repo — branch read failed: ${info.message}`
      : info.detached
        ? `${scope} repo — detached HEAD (not on a branch)`
        : `${scope} repo — on branch ${info.branch}`;
  return (
    <span
      style={chipStyle}
      data-testid={`branch-${scope}`}
      data-state={state}
      title={title}
    >
      <span style={labelStyle}>{scope}</span>
      <span style={glyphStyle} aria-hidden="true">
        ⎇
      </span>
      <span style={state === 'ok' ? valueStyle : abnormalValueStyle}>{value}</span>
    </span>
  );
}

// The same visual language as ShapeChips — informational, passive, no click.
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
  background: 'var(--color-border)',
  color: 'var(--color-text-2)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  maxWidth: '14rem',
};

const labelStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: '0.62rem',
};

const glyphStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.68rem',
};

const valueStyle: React.CSSProperties = {
  color: 'var(--color-text-2)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.68rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Detached / failed — the abnormal states read as a warning, not a name. */
const abnormalValueStyle: React.CSSProperties = {
  ...valueStyle,
  fontFamily: 'inherit',
  fontStyle: 'italic',
  color: 'var(--color-amber)',
};
