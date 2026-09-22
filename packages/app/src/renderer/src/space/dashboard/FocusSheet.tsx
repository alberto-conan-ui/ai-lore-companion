import type { FocusCard } from '@ai-lore-companion/core';
import type { CSSProperties, JSX } from 'react';
import { ModalSheet } from '../../components/overlay/ModalSheet.js';
import { secondaryButtonStyle } from '../styles.js';
import { isPausedFocus, itemStateText, itemsDoneText } from './dashboardText.js';
import { linkStyle, openLink } from './format.js';

type Props = {
  focus: FocusCard;
  onClose: () => void;
};

/**
 * The focus sheet (phase M7.3): a focus's items with their state as their
 * issues have it, and links to each issue on GitHub and to the spec. It shows
 * the card it was opened from; the model is not read again.
 */
export function FocusSheet({ focus, onClose }: Props): JSX.Element {
  return (
    <ModalSheet
      label={`Focus #${focus.issue.number}`}
      onClose={onClose}
      testId="dashboard-focus-sheet"
      backdropTestId="dashboard-focus-sheet-backdrop"
      panelStyle={panelStyle}
    >
      <h2 style={headingStyle}>
        #{focus.issue.number} {focus.title}
      </h2>
      <p style={metaStyle} data-testid="dashboard-sheet-summary">
        Stage {focus.stage ?? '(none)'}; {focus.kind === null ? 'no kind' : `kind ${focus.kind}`};{' '}
        {focus.state}; {itemsDoneText(focus)}
        {isPausedFocus(focus) ? '; paused' : ''}
      </p>
      {focus.gateNote !== null ? (
        <p style={metaStyle} data-testid="dashboard-sheet-gate">
          Waits at a gate: {focus.gateNote}
        </p>
      ) : null}
      <div style={linksStyle}>
        <button
          type="button"
          style={linkStyle}
          onClick={() => openLink(focus.issue.url)}
          data-testid="dashboard-sheet-github"
        >
          Issue on GitHub
        </button>
        {focus.specUrl !== null ? (
          <button
            type="button"
            style={linkStyle}
            onClick={() => openLink(focus.specUrl as string)}
            data-testid="dashboard-sheet-spec"
          >
            Spec
          </button>
        ) : null}
      </div>
      <h3 style={subheadingStyle}>Items ({focus.itemsTotal})</h3>
      {focus.items.length === 0 ? (
        <p style={metaStyle}>This focus has no item.</p>
      ) : (
        <ul style={listStyle} data-testid="dashboard-sheet-items">
          {focus.items.map((item) => (
            <li
              key={item.issue.url}
              style={itemStyle}
              data-testid="dashboard-sheet-item"
              data-issue={item.issue.number}
              data-done={item.done ? 'true' : 'false'}
            >
              <span style={itemTitleStyle}>
                #{item.issue.number} {item.title}
              </span>
              <span style={metaStyle} data-testid="dashboard-sheet-item-state">
                {itemStateText(item)}
              </span>
              <button
                type="button"
                style={linkStyle}
                onClick={() => openLink(item.issue.url)}
                data-testid="dashboard-sheet-item-github"
              >
                Issue on GitHub
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={footerStyle}>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={onClose}
          data-testid="dashboard-sheet-close"
        >
          Close
        </button>
      </div>
    </ModalSheet>
  );
}

const panelStyle: CSSProperties = {
  top: '10vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(40rem, 90vw)',
  maxHeight: '80vh',
  overflowY: 'auto',
  padding: '1rem 1.25rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '8px',
  color: 'var(--color-text)',
};
const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  color: 'var(--color-text-bright)',
};
const subheadingStyle: CSSProperties = { margin: '0.9rem 0 0.4rem', fontSize: '0.85rem' };
const metaStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
};
const linksStyle: CSSProperties = { display: 'flex', gap: '1rem' };
const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};
const itemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0.4rem 0.5rem',
  border: '1px solid var(--color-border-faint)',
  borderRadius: '5px',
};
const itemTitleStyle: CSSProperties = { fontSize: '0.85rem', color: 'var(--color-text-bright)' };
const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: '1rem',
};
