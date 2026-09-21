import type { BoardRow } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { openDialogTicket } from '../dialogs/useDialogQueue.js';
import './dashboard.css';
import { linkStyle } from './FocusesByStage.js';
import { BOARD_COLUMNS, durationText, issueName, openIssue } from './agentsText.js';

type Props = {
  /** The rows of the Dashboard's model (`model.board`), one per session issue. */
  board: readonly BoardRow[];
  /** Definition title when this factual widget is placed in a custom dashboard. */
  title?: string;
};

/**
 * The Agents board of the Dashboard (phase M7.4): the columns Read only,
 * Writing, Blocked and Done, with a row per session issue. A row shows the
 * issue's title, the item the session is on when this desk knows it, whether
 * it is stale (in words, not by colour only), a pending gate with an action
 * that opens its dialog, and a link to the issue.
 */
export function AgentsBoard({ board, title }: Props): JSX.Element {
  return (
    <section
      className="dashboard-section"
      aria-labelledby="agents-board-title"
      data-testid="agents-board"
    >
      <h2 id="agents-board-title" className="dashboard-heading">
        {title ?? 'Agents board'}{' '}
        <span className="dashboard-heading-count">· {board.length} sessions</span>
      </h2>
      <div className="dashboard-agents">
        {BOARD_COLUMNS.map((column) => {
          const rows = board.filter((row) => row.column === column);
          const id = `agents-column-${column.toLowerCase().replace(' ', '-')}`;
          return (
            <section
              key={column}
              className="dashboard-agent-group"
              data-empty={rows.length === 0}
              aria-labelledby={id}
              data-testid={id}
            >
              <h3 id={id} className="dashboard-subheading">
                {column} ({rows.length})
              </h3>
              {rows.length === 0 ? (
                <p className="dashboard-empty">No session.</p>
              ) : (
                <ul className="dashboard-agent-list">
                  {rows.map((row) => (
                    <BoardRowItem key={`${row.issue.repository}#${row.issue.number}`} row={row} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BoardRowItem({ row }: { row: BoardRow }): JSX.Element {
  const item = row.local?.item ?? null;
  return (
    <li className="dashboard-agent-row" data-testid={`agents-row-${row.issue.number}`}>
      <span className="dashboard-agent-title">{row.title}</span>
      <span className="dashboard-agent-meta">
        Item:{' '}
        {item === null ? (
          'not recorded on this desk'
        ) : (
          <button type="button" style={linkStyle} onClick={() => openIssue(item)}>
            {issueName(item)}
          </button>
        )}
      </span>
      <span className="dashboard-agent-meta">
        {row.person} on {row.machine}
        {row.attended ? ', attended' : ', unattended'}
        {row.local === null ? '' : ', on this desk'}
      </span>
      <span
        className="dashboard-agent-targets"
        data-testid={`agents-row-targets-${row.issue.number}`}
      >
        Targets recorded on issue:{' '}
        {row.targets.length === 0
          ? 'no targets'
          : row.targets
              .map((target) =>
                target.kind === 'lore'
                  ? 'the Lore'
                  : target.kind === 'repository'
                    ? `${target.name} · ${target.branch}`
                    : target.name,
              )
              .join(', ')}
      </span>
      {!row.stale ? (
        <span className="dashboard-agent-meta">
          GitHub idle: {row.idleMs === null ? 'unknown' : durationText(row.idleMs)}
        </span>
      ) : null}
      {row.stale ? (
        <span
          className="dashboard-agent-stale"
          data-testid={`agents-row-stale-${row.issue.number}`}
        >
          Stale: no change on GitHub for {durationText(row.idleMs ?? 0)}.
        </span>
      ) : null}
      {row.local !== null && row.local.unguarded.length > 0 ? (
        <span
          className="dashboard-agent-unguarded"
          data-testid={`agents-row-unguarded-${row.issue.number}`}
        >
          Unguarded: started with {row.local.unguarded.join(', ')}.
        </span>
      ) : null}
      {row.gateTicket !== null ? (
        <span className="dashboard-agent-meta">
          A gate waits for your answer.{' '}
          <button
            type="button"
            className="dashboard-pill"
            onClick={() => {
              if (row.gateTicket !== null) openDialogTicket(row.gateTicket);
            }}
          >
            Open the gate
          </button>
        </span>
      ) : null}
      {/* Buttons, not links: a link's middle click would open GitHub in a window of the app. */}
      <button
        type="button"
        style={{ ...linkStyle, alignSelf: 'flex-start' }}
        onClick={() => openIssue(row.issue)}
      >
        Issue {issueName(row.issue)}
      </button>
    </li>
  );
}
