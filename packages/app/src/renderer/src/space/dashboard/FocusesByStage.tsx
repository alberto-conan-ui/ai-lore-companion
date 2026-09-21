import { linkStyle, openLink } from './v2/format.js';

import type { DashboardModel, FocusCard, ItemCard } from '@ai-lore-companion/core';
import type { CSSProperties, JSX } from 'react';
import { isPausedFocus, itemStateText, itemsDoneText, unstagedReason } from './dashboardText.js';

/**
 * Open a link as the app opens links: in the system's browser, never in a
 * window of the app. `urlOpenExternal` hands the system only an `http` or
 * `https` address, which matters for a spec link read from an issue's body.
 */

type Props = {
  model: DashboardModel;
  /** Open the focus sheet of a card. */
  onOpen: (focus: FocusCard) => void;
};

/** Stage names and order always come from the Project, including custom stages. */
export function FocusesByStage({ model, onOpen }: Props): JSX.Element {
  const focuses = [...model.columns.flatMap((column) => column.focuses), ...model.unstaged];
  const paused = focuses.filter(isPausedFocus);
  const items = new Map(
    [...focuses.flatMap((focus) => focus.items), ...model.standalone].map((item) => [
      item.issue.url,
      item,
    ]),
  );
  const activeCount = (cards: FocusCard[]): number =>
    cards.filter((focus) => !isPausedFocus(focus)).length;
  const largestStage = Math.max(1, ...model.columns.map((column) => activeCount(column.focuses)));
  return (
    <div className="dashboard-focuses">
      <p className="dashboard-summary" data-testid="dashboard-overview-counts">
        {focuses.length} focuses · {items.size} items ·{' '}
        {[...items.values()].filter((item) => item.done).length} done
      </p>
      <div
        className="dashboard-funnel"
        aria-label="Focuses by Stage"
        data-testid="dashboard-columns"
      >
        {model.columns.map((column) => (
          <section
            key={column.id}
            aria-labelledby={`dashboard-column-${column.id}`}
            data-testid="dashboard-column"
            data-stage={column.name}
          >
            <div className="dashboard-funnel-bar" aria-hidden="true">
              <span style={{ height: `${(activeCount(column.focuses) / largestStage) * 100}%` }} />
            </div>
            <h3 id={`dashboard-column-${column.id}`}>
              {column.name} ({activeCount(column.focuses)})
            </h3>
          </section>
        ))}
        <div className="dashboard-funnel-extra">
          <strong>{paused.length}</strong>
          <span>Paused focuses</span>
        </div>
        <div className="dashboard-funnel-extra">
          <strong>{model.standalone.length}</strong>
          <span>Standalone items</span>
        </div>
      </div>
      <ul className="dashboard-focus-grid" aria-label="Focus cards">
        {model.columns
          .flatMap((column) => column.focuses.filter((focus) => !isPausedFocus(focus)))
          .map((focus) => (
            <FocusCardView key={focus.issue.url} focus={focus} onOpen={onOpen} />
          ))}
      </ul>
      {paused.length > 0 ? (
        <section className="dashboard-paused" aria-label="Paused focuses">
          <span className="dashboard-muted">Paused:</span>
          {paused.map((focus) => (
            <button
              key={focus.issue.url}
              type="button"
              style={linkStyle}
              onClick={() => onOpen(focus)}
              aria-haspopup="dialog"
              data-testid="dashboard-focus-paused"
            >
              #{focus.issue.number} {focus.title} · {focus.stage ?? 'no Stage'}
            </button>
          ))}
        </section>
      ) : null}
      {model.unstaged.filter((focus) => !isPausedFocus(focus)).length > 0 ? (
        <section aria-labelledby="dashboard-unstaged-heading" data-testid="dashboard-unstaged">
          <h3 id="dashboard-unstaged-heading" className="dashboard-subheading">
            Focuses not in a Stage column (
            {model.unstaged.filter((focus) => !isPausedFocus(focus)).length})
          </h3>
          <ul className="dashboard-focus-grid">
            {model.unstaged
              .filter((focus) => !isPausedFocus(focus))
              .map((focus) => (
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
      <details className="dashboard-standalone" data-testid="dashboard-standalone">
        <summary>Standalone items ({model.standalone.length})</summary>
        {model.standalone.length === 0 ? (
          <p className="dashboard-empty">No standalone item.</p>
        ) : (
          <ul className="dashboard-focus-grid">
            {model.standalone.map((item) => (
              <StandaloneItem key={item.issue.url} item={item} />
            ))}
          </ul>
        )}
      </details>
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
      className="dashboard-focus-card"
      data-testid="dashboard-focus-card"
      data-issue={focus.issue.number}
      data-done={focus.done ? 'true' : 'false'}
    >
      <span className="dashboard-stage-chip">{focus.stage ?? 'No Stage'}</span>
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
      <progress
        className="dashboard-focus-progress"
        value={focus.itemsDone}
        max={Math.max(1, focus.itemsTotal)}
        aria-label={`Items done for ${focus.title}`}
      />
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
      className="dashboard-focus-card"
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
