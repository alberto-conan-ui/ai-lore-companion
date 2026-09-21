import type { RepositoryRow } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import './dashboard.css';
import { linkStyle } from './FocusesByStage.js';
import {
  branchText,
  changesText,
  failedRowText,
  githubSuffix,
  noRepositoryText,
  operationText,
  readingRowText,
  readingSectionText,
  remoteText,
  uncommittedText,
  untrackedRowText,
} from './repositoriesText.js';
import { useRepositoriesState } from './useRepositoriesState.js';

type Props = {
  /** `Date.now()` at this render, from the Dashboard's own age tick, so the remote line's age stays current. */
  now: number;
};

/**
 * Repositories (stage D1, phase D1.4): one row per repository root of the
 * Space, with its branch, its uncommitted changes, its comparison with its
 * remote and its changes since the reviewed mark. Every sentence comes from
 * `repositoriesText.ts`, word for word from section 6.3 of the architecture
 * document. No state is shown by colour alone: the text itself says the
 * state, and a value that cannot be established says so and says why.
 *
 * Renders its heading and one line before `useRepositoriesState` gets its
 * first answer, so the section does not delay the Dashboard's first paint.
 */
export function Repositories({ now }: Props): JSX.Element {
  const { repositories } = useRepositoriesState();
  const model = repositories?.model ?? null;

  return (
    <section
      className="dashboard-section"
      aria-labelledby="repositories-title"
      data-testid="dashboard-repositories"
    >
      <h2 id="repositories-title" className="dashboard-heading">
        Repositories
      </h2>
      {model === null ? (
        <p className="dashboard-empty" data-testid="dashboard-repositories-reading">
          {repositories?.problem ?? readingSectionText()}
        </p>
      ) : model.rows.length === 0 ? (
        <p className="dashboard-empty" data-testid="dashboard-repositories-empty">
          {noRepositoryText()}
        </p>
      ) : (
        <ul className="dashboard-repository-list">
          {model.rows.map((row) => (
            <RepositoryRowItem key={row.rootId} row={row} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RepositoryRowItem({ row, now }: { row: RepositoryRow; now: number }): JSX.Element {
  const navigate = (): void => {
    void window.cockpit.spaceNavigate({ to: 'space-files', open: { rootId: row.rootId } });
  };

  return (
    <li
      className="dashboard-repository-row"
      data-testid="repository-row"
      data-root-id={row.rootId}
      data-status={row.status}
      data-kind={row.kind}
    >
      <p className="dashboard-repository-name">
        <button
          type="button"
          style={{ ...linkStyle, marginTop: 0, fontWeight: 600 }}
          onClick={navigate}
          data-testid="repository-row-name"
        >
          {row.name}
        </button>
        {row.github !== null ? (
          <span className="dashboard-muted">{githubSuffix(row.github)}</span>
        ) : null}
      </p>
      {row.status === 'reading' ? (
        <p className="dashboard-repository-detail" data-testid="repository-row-reading">
          {readingRowText()}
        </p>
      ) : null}
      {row.status === 'untracked' ? (
        <p className="dashboard-repository-detail" data-testid="repository-row-untracked">
          {untrackedRowText(row.notKnown ?? '')}
        </p>
      ) : null}
      {row.status === 'failed' ? (
        <p className="dashboard-repository-detail" data-testid="repository-row-failed">
          {failedRowText(row.notKnown ?? '')}
        </p>
      ) : null}
      {row.status === 'ready' ? (
        <>
          {row.head !== null ? (
            <p className="dashboard-repository-detail" data-testid="repository-row-branch">
              {branchText(row.head)}
            </p>
          ) : null}
          {row.operation !== null ? (
            <p className="dashboard-repository-detail" data-testid="repository-row-operation">
              {operationText(row.operation, row.head)}
            </p>
          ) : null}
          {row.changes !== null ? (
            <p className="dashboard-repository-detail" data-testid="repository-row-uncommitted">
              {uncommittedText(row.changes)}
            </p>
          ) : null}
          {row.remote !== null ? (
            <p className="dashboard-repository-detail" data-testid="repository-row-remote">
              {remoteText(row.head, row.remote, now)}
            </p>
          ) : null}
          <p className="dashboard-repository-detail" data-testid="repository-row-changes">
            {changesText(row.changes, row.status)}
          </p>
        </>
      ) : null}
    </li>
  );
}
