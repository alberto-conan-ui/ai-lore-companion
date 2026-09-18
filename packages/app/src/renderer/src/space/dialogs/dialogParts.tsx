import type { CSSProperties, JSX } from 'react';
import type { DialogAsker } from '../../../../shared/ipc.js';

/** Which session asks, as its header names it: engine, start time, item. */
export function askerWords(session: DialogAsker | null): string {
  if (session === null) return 'A session the desk has no record of';
  const item = session.item === null ? 'on no item' : `on item #${session.item}`;
  return `The ${session.engine} session ${item} that started at ${session.startedAt}`;
}

/** One labelled line of a dialog: a term and its value. */
export function Field(props: {
  term: string;
  children: React.ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <dt style={termStyle}>{props.term}</dt>
      <dd style={valueStyle} {...(props.testId ? { 'data-testid': props.testId } : {})}>
        {props.children}
      </dd>
    </div>
  );
}

/** The panel of both dialogs, centred, with room for a long request. */
export const dialogPanelStyle: CSSProperties = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(640px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '1rem 1.25rem',
  background: 'var(--color-panel)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '8px',
  fontSize: '0.85rem',
};

export const dialogHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '1rem',
};

export const dialogHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--color-text-bright)',
};

export const countStyle: CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontSize: '0.8rem',
  whiteSpace: 'nowrap',
};

export const fieldListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  margin: 0,
};

const fieldStyle: CSSProperties = { display: 'flex', gap: '0.75rem' };

const termStyle: CSSProperties = {
  flex: '0 0 7.5rem',
  color: 'var(--color-text-secondary)',
};

const valueStyle: CSSProperties = {
  margin: 0,
  flex: 1,
  minWidth: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

export const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

export const noteStyle: CSSProperties = {
  margin: 0,
  color: 'var(--color-text-secondary)',
};

export const warnNoteStyle: CSSProperties = {
  margin: 0,
  padding: '0.5rem 0.75rem',
  color: 'var(--color-amber-tag-fg)',
  background: 'var(--color-amber-tag-bg)',
  border: '1px solid var(--color-amber-tag-border)',
  borderRadius: '5px',
};

export const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
