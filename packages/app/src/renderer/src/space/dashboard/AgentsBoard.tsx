import type { BoardRow } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { openDialogTicket } from '../dialogs/useDialogQueue.js';
import { secondaryButtonStyle } from '../styles.js';
import { linkStyle } from './FocusesByStage.js';
import { BOARD_COLUMNS, durationText, issueName, openIssue } from './agentsText.js';

type Props = {
  /** The rows of the Dashboard's model (`model.board`), one per session issue. */
  board: readonly BoardRow[];
};

/**
 * The Agents board of the Dashboard (phase M7.4): the columns Read only,
 * Writing, Blocked and Done, with a row per session issue. A row shows the
 * issue's title, the item the session is on when this desk knows it, whether
 * it is stale (in words, not by colour only), a pending gate with an action
 * that opens its dialog, and a link to the issue.
 */
export function AgentsBoard({ board }: Props): JSX.Element {
  return (
    <section style={boardStyle} aria-labelledby="agents-board-title" data-testid="agents-board">
      <h2 id="agents-board-title" style={titleStyle}>
        Agents board
      </h2>
      <div style={columnsStyle}>
        {BOARD_COLUMNS.map((column) => {
          const rows = board.filter((row) => row.column === column);
          const id = `agents-column-${column.toLowerCase().replace(' ', '-')}`;
          return (
            <section key={column} style={columnStyle} aria-labelledby={id} data-testid={id}>
              <h3 id={id} style={columnTitleStyle}>
                {column} ({rows.length})
              </h3>
              {rows.length === 0 ? (
                <p style={emptyStyle}>No session.</p>
              ) : (
                <ul style={listStyle}>
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
    <li style={rowStyle} data-testid={`agents-row-${row.issue.number}`}>
      <span style={rowTitleStyle}>{row.title}</span>
      <span style={lineStyle}>
        Item:{' '}
        {item === null ? (
          'not recorded on this desk'
        ) : (
          <button type="button" style={linkStyle} onClick={() => openIssue(item)}>
            {issueName(item)}
          </button>
        )}
      </span>
      <span style={lineStyle}>
        {row.person} on {row.machine}
        {row.attended ? ', attended' : ', unattended'}
        {row.local === null ? '' : ', on this desk'}
      </span>
      {row.stale ? (
        <span style={staleStyle} data-testid={`agents-row-stale-${row.issue.number}`}>
          Stale: no change on GitHub for {durationText(row.idleMs ?? 0)}.
        </span>
      ) : null}
      {row.local !== null && row.local.unguarded.length > 0 ? (
        <span style={unguardedStyle} data-testid={`agents-row-unguarded-${row.issue.number}`}>
          Unguarded: started with {row.local.unguarded.join(', ')}.
        </span>
      ) : null}
      {row.gateTicket !== null ? (
        <span style={lineStyle}>
          A gate waits for your answer.{' '}
          <button
            type="button"
            style={smallButtonStyle}
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

const boardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  minWidth: 0,
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };

const columnsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(10rem, 1fr))',
  gap: '0.5rem',
};

const columnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  minWidth: 0,
  padding: '0.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const columnTitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.8rem', fontWeight: 600 };

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
  padding: '0.4rem',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
  fontSize: '0.8rem',
};

const rowTitleStyle: React.CSSProperties = { fontWeight: 600 };

const lineStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };

const staleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-amber-tag-fg)',
};

const unguardedStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-danger-fg)',
};

const smallButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.1rem 0.5rem',
  fontSize: '0.75rem',
};
