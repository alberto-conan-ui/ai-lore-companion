import type { DashboardModel, FocusCard, ItemCard } from '@ai-lore-companion/core';
import type { CSSProperties, JSX } from 'react';
import { isPausedFocus, itemStateText, itemsDoneText, unstagedReason } from './dashboardText.js';

/**
 * Open a link as the app opens links: in the system's browser, never in a
 * window of the app. `urlOpenExternal` hands the system only an `http` or
 * `https` address, which matters for a spec link read from an issue's body.
 */
export function openLink(url: string): void {
  window.cockpit.urlOpenExternal(url);
}

type Props = {
  model: DashboardModel;
  /** Open the focus sheet of a card. */
  onOpen: (focus: FocusCard) => void;
};

/**
 * Focuses by Stage (phase M7.3): one column per option of the Project's Stage
 * field, in the model's order, with a card per focus; the focuses whose Stage
 * is not a column, each with its reason; the standalone items beside the
 * columns. Every name is the Project's own.
 */
export function FocusesByStage({ model, onOpen }: Props): JSX.Element {
  return (
    <div style={wrapStyle}>
      <div style={rowStyle} data-testid="dashboard-columns">
        {model.columns.map((column) => (
          <section
            key={column.id}
            style={columnStyle}
            aria-labelledby={`dashboard-column-${column.id}`}
            data-testid="dashboard-column"
            data-stage={column.name}
          >
            <h3 id={`dashboard-column-${column.id}`} style={columnHeadingStyle}>
              {column.name} ({column.focuses.length})
            </h3>
            {column.focuses.length === 0 ? (
              <p style={emptyStyle}>No focus.</p>
            ) : (
              <ul style={listStyle}>
                {column.focuses.map((focus) => (
                  <FocusCardView key={focus.issue.url} focus={focus} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>
        ))}
        <section
          style={standaloneStyle}
          aria-labelledby="dashboard-standalone-heading"
          data-testid="dashboard-standalone"
        >
          <h3 id="dashboard-standalone-heading" style={columnHeadingStyle}>
            Standalone items ({model.standalone.length})
          </h3>
          {model.standalone.length === 0 ? (
            <p style={emptyStyle}>No standalone item.</p>
          ) : (
            <ul style={listStyle}>
              {model.standalone.map((item) => (
                <StandaloneItem key={item.issue.url} item={item} />
              ))}
            </ul>
          )}
        </section>
      </div>
      {model.unstaged.length > 0 ? (
        <section aria-labelledby="dashboard-unstaged-heading" data-testid="dashboard-unstaged">
          <h3 id="dashboard-unstaged-heading" style={columnHeadingStyle}>
            Focuses not in a Stage column ({model.unstaged.length})
          </h3>
          <ul style={unstagedListStyle}>
            {model.unstaged.map((focus) => (
              <FocusCardView
                key={focus.issue.url}
                focus={focus}
                onOpen={onOpen}
                reason={unstagedReason(focus)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FocusCardView({
  focus,
  onOpen,
  reason,
}: {
  focus: FocusCard;
  onOpen: (focus: FocusCard) => void;
  reason?: string;
}): JSX.Element {
  return (
    <li
      style={cardStyle}
      data-testid="dashboard-focus-card"
      data-issue={focus.issue.number}
      data-done={focus.done ? 'true' : 'false'}
    >
      <h4 style={cardHeadingStyle}>
        <button
          type="button"
          style={titleButtonStyle}
          onClick={() => onOpen(focus)}
          aria-haspopup="dialog"
          data-testid="dashboard-focus-open"
        >
          #{focus.issue.number} {focus.title}
        </button>
      </h4>
      <p style={metaStyle} data-testid="dashboard-focus-kind">
        {focus.kind === null ? 'no kind' : `kind ${focus.kind}`}
      </p>
      <p style={metaStyle} data-testid="dashboard-focus-items">
        {itemsDoneText(focus)}
        {focus.done ? '; focus done' : ''}
      </p>
      {isPausedFocus(focus) ? (
        <p style={metaStyle} data-testid="dashboard-focus-paused">
          Paused.
        </p>
      ) : null}
      {reason ? (
        <p style={metaStyle} data-testid="dashboard-focus-reason">
          {reason}
        </p>
      ) : null}
      {focus.gateNote !== null ? (
        <p style={gateStyle} data-testid="dashboard-focus-gate">
          Waits at a gate: {focus.gateNote}
        </p>
      ) : null}
      {focus.specUrl !== null ? (
        <button
          type="button"
          style={linkStyle}
          onClick={() => openLink(focus.specUrl as string)}
          data-testid="dashboard-focus-spec"
        >
          Spec
        </button>
      ) : null}
    </li>
  );
}

function StandaloneItem({ item }: { item: ItemCard }): JSX.Element {
  return (
    <li
      style={cardStyle}
      data-testid="dashboard-standalone-item"
      data-issue={item.issue.number}
      data-paused={item.paused ? 'true' : 'false'}
    >
      <p style={itemTitleStyle}>
        #{item.issue.number} {item.title}
      </p>
      <p style={metaStyle} data-testid="dashboard-standalone-state">
        {itemStateText(item)}
      </p>
      <button
        type="button"
        style={linkStyle}
        onClick={() => openLink(item.issue.url)}
        data-testid="dashboard-standalone-github"
      >
        Issue on GitHub
      </button>
    </li>
  );
}

const wrapStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const rowStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'flex-start',
  overflowX: 'auto',
  paddingBottom: '0.25rem',
};
const columnStyle: CSSProperties = {
  flex: '0 0 15rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  padding: '0.5rem',
};
const standaloneStyle: CSSProperties = { ...columnStyle, flex: '0 0 12rem' };
const columnHeadingStyle: CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
};
const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};
const unstagedListStyle: CSSProperties = { ...listStyle, flexDirection: 'row', flexWrap: 'wrap' };
const cardStyle: CSSProperties = {
  background: 'var(--color-raised)',
  border: '1px solid var(--color-border-faint)',
  borderRadius: '5px',
  padding: '0.45rem 0.55rem',
  minWidth: '12rem',
};
const cardHeadingStyle: CSSProperties = { margin: 0, fontSize: '0.85rem' };
const titleButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-text-bright)',
  font: 'inherit',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
};
const itemTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-bright)',
};
const metaStyle: CSSProperties = {
  margin: '0.2rem 0 0',
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};
const gateStyle: CSSProperties = { ...metaStyle, color: 'var(--color-warn-fg)' };
const emptyStyle: CSSProperties = { ...metaStyle, margin: 0 };
export const linkStyle: CSSProperties = {
  marginTop: '0.3rem',
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-link)',
  fontSize: '0.75rem',
  textDecoration: 'underline',
  cursor: 'pointer',
};
