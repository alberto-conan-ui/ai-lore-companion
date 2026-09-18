import type { IssueRef, NeedsYouEntry } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { openDialogTicket } from '../dialogs/useDialogQueue.js';
import { secondaryButtonStyle } from '../styles.js';
import { useSpaceNavStore } from '../window/spaceNavStore.js';
import { durationText, issueName, openIssue } from './agentsText.js';

type Props = {
  /** The entries of the Dashboard's model (`model.needsYou`), in its order. */
  entries: readonly NeedsYouEntry[];
  /**
   * Open a focus in the Dashboard's focus sheet (phase M7.3). Without it, the
   * action of a review opens the focus's issue on GitHub.
   */
  onOpenFocus?: (focus: IssueRef) => void;
};

/** The label of each kind of entry: its internal name, in words. */
export const NEEDS_YOU_LABELS: Record<NeedsYouEntry['kind'], string> = {
  gate: 'Gate',
  review: 'Review',
  'stale-session': 'Stale session',
};

/**
 * Needs you (phase M7.4): the pending gates, the focuses at Review and the
 * stale sessions, in the order of the model, with one action each. A gate
 * opens the gate dialog of its ticket; a review opens the focus; a stale
 * session opens its tab in Sessions when this window has one, and its issue
 * otherwise.
 */
export function NeedsYou({ entries, onOpenFocus }: Props): JSX.Element {
  const sessionsWithTab = useSpaceNavStore((state) => state.sessionsWithTab);
  const showSessionTab = useSpaceNavStore((state) => state.showSessionTab);

  const action = (entry: NeedsYouEntry): { label: string; run: () => void } => {
    if (entry.kind === 'gate') {
      return { label: 'Open the gate dialog', run: () => openDialogTicket(entry.ticket) };
    }
    if (entry.kind === 'review') {
      return {
        label: 'Open the focus',
        run: () => (onOpenFocus ? onOpenFocus(entry.focus) : openIssue(entry.focus)),
      };
    }
    const sessionId = entry.sessionId;
    if (sessionId !== null && sessionsWithTab.includes(sessionId)) {
      return { label: 'Open its tab', run: () => showSessionTab(sessionId) };
    }
    return { label: 'Open its issue', run: () => openIssue(entry.issue) };
  };

  return (
    <section style={sectionStyle} aria-labelledby="needs-you-title" data-testid="needs-you">
      <h2 id="needs-you-title" style={titleStyle}>
        Needs you ({entries.length})
      </h2>
      {entries.length === 0 ? (
        <p style={emptyStyle}>Nothing needs you.</p>
      ) : (
        <ol style={listStyle}>
          {entries.map((entry, index) => {
            const { label, run } = action(entry);
            return (
              <li key={keyOf(entry)} style={itemStyle} data-testid={`needs-you-${index}`}>
                <span style={kindStyle}>{NEEDS_YOU_LABELS[entry.kind]}</span>
                <span style={textStyle}>{describe(entry)}</span>
                <button type="button" style={buttonStyle} onClick={run}>
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function keyOf(entry: NeedsYouEntry): string {
  if (entry.kind === 'gate') return `gate-${entry.ticket}`;
  if (entry.kind === 'review') return `review-${issueName(entry.focus)}`;
  return `stale-${issueName(entry.issue)}`;
}

function describe(entry: NeedsYouEntry): string {
  if (entry.kind === 'gate') {
    const on = entry.item === null ? '' : ` The session is on ${issueName(entry.item)}.`;
    return `The process ${entry.process} asks at the step ${entry.step}: ${entry.question}${on}`;
  }
  if (entry.kind === 'review') {
    return `The focus "${entry.title}" (${issueName(entry.focus)}) is at Review.`;
  }
  return `The session issue ${issueName(entry.issue)} is in ${entry.column} with no change on GitHub for ${durationText(entry.idleMs)}.`;
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  minWidth: 0,
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.35rem 0.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
  fontSize: '0.8rem',
};

const kindStyle: React.CSSProperties = { fontWeight: 600, flexShrink: 0 };

const textStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const buttonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.15rem 0.6rem',
  fontSize: '0.8rem',
  flexShrink: 0,
};
