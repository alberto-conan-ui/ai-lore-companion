import { type JSX, type ReactNode, useEffect, useState } from 'react';
import {
  type MemoryEntry,
  type MemoryListDirResult,
  isMemoryListDirError,
} from '../../../shared/ipc.js';

/**
 * Three first-class v0.5 areas surfaced as sheets — Save-points, References,
 * Blueprint (three-branch). Each fetches its data via `IPC.MemoryListDir`
 * and renders frontmatter-aware entries, with empty-state messaging when an
 * area is absent or empty.
 */

const SAVE_POINTS_REL = 'memory/save-points';
const REFERENCES_REL = 'references';
const BLUEPRINT_BRANCHES = ['contracts', 'processes', 'mirror'] as const;
type BlueprintBranchKey = (typeof BLUEPRINT_BRANCHES)[number];

export function SavePointsView({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <AreaSheet title="Save-points" onClose={onClose} testId="save-points-view">
      <SavePointsList />
    </AreaSheet>
  );
}

export function ReferencesView({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <AreaSheet title="References" onClose={onClose} testId="references-view">
      <ReferencesList />
    </AreaSheet>
  );
}

export function BlueprintView({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <AreaSheet title="Blueprint" onClose={onClose} testId="blueprint-view">
      <BlueprintList />
    </AreaSheet>
  );
}

function SavePointsList(): JSX.Element {
  const list = useMemoryListing(SAVE_POINTS_REL);
  if (list === null) return <Loading />;
  if (isMemoryListDirError(list)) return <ErrorMessage message={list.error} />;
  if (list.entries.length === 0) {
    return (
      <EmptyMessage
        testId="save-points-empty"
        text="No save-points recorded yet. Invoke /ai-lore-save-point to anchor a milestone."
      />
    );
  }
  return (
    <ul style={listStyle} data-testid="save-points-list">
      {list.entries.map((entry) => (
        <SavePointRow key={entry.path} entry={entry} />
      ))}
    </ul>
  );
}

function SavePointRow({ entry }: { entry: MemoryEntry }): JSX.Element {
  const fm = entry.frontmatter;
  const date = fm?.type === 'save-point' ? fm.date : fm?.updated;
  const lore = fm?.type === 'save-point' ? fm.lore_commit : undefined;
  const payload = fm?.type === 'save-point' ? fm.payload_commit : undefined;
  const title = fm?.title ?? entry.name;
  return (
    <li style={rowStyle} data-testid="save-point-row">
      <div style={rowHeaderStyle}>
        <span style={rowDateStyle} data-testid="save-point-date">
          {date ?? ''}
        </span>
        <span style={rowTitleStyle} data-testid="save-point-title">
          {title}
        </span>
      </div>
      {(lore || payload) && (
        <div style={rowMetaStyle} data-testid="save-point-commits">
          {lore ? <code style={codeStyle}>lore {short(lore)}</code> : null}
          {payload ? <code style={codeStyle}>payload {short(payload)}</code> : null}
        </div>
      )}
      {entry.body.trim() ? (
        <pre style={rowBodyStyle} data-testid="save-point-body">
          {entry.body.trim()}
        </pre>
      ) : null}
    </li>
  );
}

function ReferencesList(): JSX.Element {
  const list = useMemoryListing(REFERENCES_REL);
  if (list === null) return <Loading />;
  if (isMemoryListDirError(list)) return <ErrorMessage message={list.error} />;
  if (list.entries.length === 0) {
    return (
      <EmptyMessage
        testId="references-empty"
        text="No references registered — this project does not consult other AI-Lore projects."
      />
    );
  }
  return (
    <ul style={listStyle} data-testid="references-list">
      {list.entries.map((entry) => (
        <ReferenceRow key={entry.path} entry={entry} />
      ))}
    </ul>
  );
}

function ReferenceRow({ entry }: { entry: MemoryEntry }): JSX.Element {
  const fm = entry.frontmatter;
  const isRef = fm?.type === 'reference';
  const targetPath = isRef ? fm.target_path : undefined;
  const purpose = isRef ? fm.purpose : undefined;
  const scope = isRef ? fm.scope : undefined;
  return (
    <li style={rowStyle} data-testid="reference-row">
      <div style={rowHeaderStyle}>
        <span style={rowTitleStyle} data-testid="reference-title">
          {fm?.title ?? entry.name}
        </span>
      </div>
      <div style={rowMetaStyle}>
        {targetPath ? (
          <span data-testid="reference-target-path">
            <span style={chipKeyStyle}>target</span> <code style={codeStyle}>{targetPath}</code>
          </span>
        ) : null}
        {purpose ? (
          <span data-testid="reference-purpose">
            <span style={chipKeyStyle}>purpose</span> {purpose}
          </span>
        ) : null}
        {scope ? (
          <span data-testid="reference-scope">
            <span style={chipKeyStyle}>scope</span> {scope}
          </span>
        ) : null}
      </div>
      {entry.body.trim() ? <pre style={rowBodyStyle}>{entry.body.trim()}</pre> : null}
    </li>
  );
}

function BlueprintList(): JSX.Element {
  return (
    <div>
      {BLUEPRINT_BRANCHES.map((branch) => (
        <BlueprintBranchSection key={branch} branch={branch} />
      ))}
    </div>
  );
}

function BlueprintBranchSection({ branch }: { branch: BlueprintBranchKey }): JSX.Element {
  const list = useMemoryListing(`memory/blueprint/${branch}`);
  return (
    <section style={branchSectionStyle} data-testid={`blueprint-branch-${branch}`}>
      <h3 style={branchHeadingStyle}>{branch}</h3>
      {list === null ? (
        <Loading />
      ) : isMemoryListDirError(list) ? (
        <ErrorMessage message={list.error} />
      ) : list.entries.length === 0 ? (
        <EmptyMessage
          testId={`blueprint-${branch}-empty`}
          text={`No ${branch} defined — emptiness is a valid state.`}
        />
      ) : (
        <ul style={listStyle}>
          {list.entries
            .filter((e) => {
              const fm = e.frontmatter;
              // Filter by frontmatter `branch:` field per the methodology;
              // accept any entry without a typed `blueprint` frontmatter as a
              // best-effort fallback for pre-v0.5 files.
              if (!fm) return true;
              if (fm.type !== 'blueprint') return true;
              return fm.branch === branch;
            })
            .map((entry) => (
              <BlueprintRow key={entry.path} entry={entry} />
            ))}
        </ul>
      )}
    </section>
  );
}

function BlueprintRow({ entry }: { entry: MemoryEntry }): JSX.Element {
  return (
    <li style={rowStyle} data-testid="blueprint-row">
      <div style={rowHeaderStyle}>
        <span style={rowTitleStyle} data-testid="blueprint-title">
          {entry.frontmatter?.title ?? entry.name}
        </span>
      </div>
      {entry.body.trim() ? <pre style={rowBodyStyle}>{entry.body.trim()}</pre> : null}
    </li>
  );
}

function useMemoryListing(relPath: string): MemoryListDirResult | null {
  const [data, setData] = useState<MemoryListDirResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.cockpit.memoryListDir({ relPath }).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [relPath]);
  return data;
}

function AreaSheet({
  title,
  onClose,
  testId,
  children,
}: {
  title: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a backdrop + sheet pattern; <dialog> doesn't fit the custom positioning.
    <div
      role="dialog"
      aria-label={title}
      data-testid={testId}
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={sheetStyle}>
        <div style={headerStyle}>
          <span style={titleStyle}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            data-testid={`${testId}-close`}
          >
            Close
          </button>
        </div>
        <div style={bodyStyle}>{children}</div>
      </div>
    </div>
  );
}

function Loading(): JSX.Element {
  return <p style={loadingStyle}>Loading…</p>;
}

function ErrorMessage({ message }: { message: string }): JSX.Element {
  return <p style={errorStyle}>Cannot read: {message}</p>;
}

function EmptyMessage({ text, testId }: { text: string; testId: string }): JSX.Element {
  return (
    <p style={emptyStyle} data-testid={testId}>
      {text}
    </p>
  );
}

function short(commit: string): string {
  return commit.length > 8 ? commit.slice(0, 8) : commit;
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '4rem 1rem 2rem',
  zIndex: 100,
};

const sheetStyle: React.CSSProperties = {
  background: '#0f1620',
  color: '#e6edf3',
  border: '1px solid #2f3a45',
  borderRadius: '8px',
  width: 'min(880px, 96vw)',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '1rem 1.1rem',
  borderBottom: '1px solid #2f3a45',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '1.05rem',
  letterSpacing: '0.02em',
  flex: 1,
};

const closeButtonStyle: React.CSSProperties = {
  background: '#1f2933',
  color: '#cbd5dd',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  fontSize: '0.78rem',
  fontWeight: 600,
  padding: '0.35rem 0.7rem',
  cursor: 'pointer',
};

const bodyStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '1rem 1.1rem 1.4rem',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const rowStyle: React.CSSProperties = {
  padding: '0.75rem 0.9rem',
  background: '#0a1018',
  border: '1px solid #1f2933',
  borderRadius: '5px',
};

const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',
  marginBottom: '0.35rem',
};

const rowDateStyle: React.CSSProperties = {
  color: '#9fb1bd',
  fontSize: '0.78rem',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

const rowTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#e6edf3',
};

const rowMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.55rem 0.85rem',
  fontSize: '0.78rem',
  color: '#9fb1bd',
  marginBottom: '0.35rem',
};

const rowBodyStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: '0.8rem',
  lineHeight: 1.55,
  color: '#cbd5dd',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const codeStyle: React.CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  color: '#c4e1a8',
};

const chipKeyStyle: React.CSSProperties = {
  color: '#6c7783',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: '0.7rem',
  fontWeight: 600,
};

const branchSectionStyle: React.CSSProperties = {
  marginBottom: '1.25rem',
};

const branchHeadingStyle: React.CSSProperties = {
  margin: '0 0 0.45rem',
  fontSize: '0.82rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9fb1bd',
};

const loadingStyle: React.CSSProperties = {
  margin: 0,
  color: '#9fb1bd',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: '#e58a8a',
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  color: '#6c7783',
  fontSize: '0.85rem',
  fontStyle: 'italic',
};
