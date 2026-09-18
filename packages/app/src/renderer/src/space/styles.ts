/**
 * Style objects the 1.0 screens share. They use the tokens of `theme.css`, as
 * the cockpit's components do, so both palettes apply.
 */

/** The main action of a screen. */
export const primaryButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.4rem 1rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'var(--color-text-bright)',
  background: 'var(--color-surface-blue)',
  border: '1px solid var(--color-surface-blue-border)',
  borderRadius: '5px',
  cursor: 'pointer',
};

/** Any other action of a screen. */
export const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  fontWeight: 500,
  color: 'var(--color-text)',
  background: 'transparent',
};

/** A folder's path, in the monospace face. */
export const folderPathStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
};

/** The screen's own error area: the message of a request that main refused or that failed. */
export const errorAreaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-warn-fg)',
};
