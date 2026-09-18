/** The styles of the editor of the Files window (phase M5.5), shared by its parts. */

import type { CSSProperties } from 'react';

export const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  background: 'var(--color-shell)',
};

/** Read by assistive technology, not shown. */
export const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export const emptyStyle: CSSProperties = {
  margin: 'auto',
  padding: '1rem',
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  textAlign: 'center',
};

export const stripStyle: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  overflowX: 'auto',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
};

export const tabStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.2rem',
  padding: '0 0.3rem 0 0.7rem',
  borderRight: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
};

export const tabActiveStyle: CSSProperties = {
  background: 'var(--color-shell)',
  boxShadow: 'inset 0 -2px 0 var(--color-accent)',
};

export const tabNameStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text)',
  fontSize: '0.78rem',
  padding: '0.45rem 0',
  cursor: 'pointer',
};

export const tabRootStyle: CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.7rem',
  marginLeft: '0.35rem',
};

export const dirtyDotStyle: CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  background: 'var(--color-accent)',
  flexShrink: 0,
};

export const tabCloseStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '0.95rem',
  lineHeight: 1,
  padding: '0.1rem 0.25rem',
  borderRadius: '4px',
  cursor: 'pointer',
};

export const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem',
  padding: '0.35rem 0.6rem',
  flexShrink: 0,
  background: 'var(--color-panel)',
  borderBottom: '1px solid var(--color-border)',
};

export const segmentStyle: CSSProperties = {
  display: 'inline-flex',
  margin: 0,
  padding: 0,
  minWidth: 0,
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  overflow: 'hidden',
};

export const segStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.2rem 0.7rem',
  cursor: 'pointer',
};

export const segOnStyle: CSSProperties = {
  ...segStyle,
  background: 'var(--color-tab-active)',
  color: 'var(--color-tab-active-fg)',
};

export const buttonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
};

export const smallButtonStyle: CSSProperties = {
  ...buttonStyle,
  fontSize: '0.66rem',
  padding: '0.1rem 0.4rem',
};

export const sentenceStyle: CSSProperties = {
  flexShrink: 0,
  margin: 0,
  padding: '0.35rem 0.7rem',
  fontSize: '0.76rem',
  color: 'var(--color-text-secondary)',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-panel)',
  wordBreak: 'break-word',
};

export const splitStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

export const bodyStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
};

export const hostStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

export const noticeStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  textAlign: 'center',
  whiteSpace: 'pre-wrap',
  color: 'var(--color-text-muted)',
  fontSize: '0.82rem',
  background: 'var(--color-shell)',
};

export const saveErrorStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '0.4rem 0.7rem',
  fontSize: '0.74rem',
  color: 'var(--color-danger-fg, #fff)',
  background: 'var(--color-danger, #b3261e)',
  textAlign: 'center',
};

export const savedStyle: CSSProperties = {
  position: 'absolute',
  right: '0.6rem',
  bottom: '0.4rem',
  fontSize: '0.7rem',
  color: 'var(--color-text-muted)',
};

export const historyStyle: CSSProperties = {
  width: '260px',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderRight: '1px solid var(--color-border)',
  background: 'var(--color-panel)',
};

export const historyHeadStyle: CSSProperties = {
  margin: 0,
  padding: '0.45rem 0.7rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)',
};

export const historyListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '0.25rem',
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
};

export const historyItemStyle: CSSProperties = {
  padding: '0.35rem 0.4rem',
  borderBottom: '1px solid var(--color-border)',
  fontSize: '0.72rem',
  color: 'var(--color-text-secondary)',
};

export const historyItemOnStyle: CSSProperties = {
  ...historyItemStyle,
  background: 'var(--color-tab-active)',
  color: 'var(--color-tab-active-fg)',
};

export const historyMetaStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.66rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const historyActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  marginTop: '0.25rem',
  flexWrap: 'wrap',
};

export const historyNoteStyle: CSSProperties = {
  margin: 0,
  padding: '0.5rem 0.7rem',
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
};

export const pinPanelStyle: CSSProperties = {
  flexShrink: 0,
  maxHeight: '45%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'auto',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-panel)',
  padding: '0.4rem 0.6rem',
  gap: '0.3rem',
};
