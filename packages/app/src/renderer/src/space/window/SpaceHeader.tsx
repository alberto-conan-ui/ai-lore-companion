import type { JSX } from 'react';
import type { SpaceSummary } from '../../../../shared/ipc.js';
import { folderPathStyle } from '../styles.js';

type Props = { space: SpaceSummary };

/**
 * The header of the Space window: the Space's name and its folder. The rest of
 * the header the product document describes (the checkout's state, the held
 * targets, the state of GitHub) belongs to later phases, which add to the
 * right of the folder.
 */
export function SpaceHeader({ space }: Props): JSX.Element {
  return (
    <header style={headerStyle} data-testid="space-header">
      <h1 style={nameStyle} data-testid="space-name">
        {space.name === '' ? 'Space' : space.name}
      </h1>
      <span style={pathStyle} data-testid="space-root" title={space.root}>
        {space.root}
      </span>
    </header>
  );
}

const headerStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.75rem',
  minWidth: 0,
  padding: '1.25rem 1.5rem',
  background: 'var(--color-space-tint, var(--color-header))',
  borderBottom: '2px solid var(--color-space-accent, var(--color-border))',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};

const nameStyle: React.CSSProperties = {
  margin: 0,
  flexShrink: 0,
  fontSize: '2rem',
  fontWeight: 700,
  color: 'var(--color-space-accent, var(--color-text-bright))',
};

const pathStyle: React.CSSProperties = {
  ...folderPathStyle,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  wordBreak: 'normal',
};
