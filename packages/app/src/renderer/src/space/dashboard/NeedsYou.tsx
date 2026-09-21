import type { IssueRef, NeedsYouEntry } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { openDialogTicket } from '../dialogs/useDialogQueue.js';
import './dashboard.css';
import { useSpaceNavStore } from '../window/spaceNavStore.js';
import { issueName, openIssue } from './agentsText.js';
import { durationText } from './v2/format.js';

type Props = {
  /** The entries of the Dashboard's model (`model.needsYou`), in its order. */
  entries: readonly NeedsYouEntry[];
  /**
   * Open a focus in the Dashboard's focus sheet (phase M7.3). Without it, the
   * action of a review opens the focus's issue on GitHub.
   */
  onOpenFocus?: (focus: IssueRef) => void;
  /** Definition title when this factual widget is placed in a custom dashboard. */
  title?: string;
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
export function NeedsYou({ entries, onOpenFocus, title }: Props): JSX.Element {
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
    <section className="dashboard-needs" aria-labelledby="needs-you-title" data-testid="needs-you">
      <h2 id="needs-you-title" className="dashboard-heading">
        {title ?? 'Needs you'} ({entries.length})
      </h2>
      {entries.length === 0 ? (
        <p className="dashboard-empty">Nothing needs you.</p>
      ) : (
        <ol className="dashboard-needs-list" aria-label="Pending decisions">
          {entries.map((entry, index) => {
            const { label, run } = action(entry);
            return (
              <li
                key={keyOf(entry)}
                className="dashboard-needs-row"
                data-kind={entry.kind}
                data-testid={`needs-you-${index}`}
              >
                <span className="dashboard-needs-kind">{NEEDS_YOU_LABELS[entry.kind]}</span>
                <div className="dashboard-needs-text">
                  {entry.kind === 'gate' ? (
                    <>
                      <strong className="dashboard-gate-question">{entry.question}</strong>
                      <span className="dashboard-muted">
                        {entry.process} · {entry.step} · {entry.sessionId}
                        {entry.item === null ? '' : ` · ${issueName(entry.item)}`}
                      </span>
                    </>
                  ) : (
                    describe(entry)
                  )}
                </div>
                <button type="button" className="dashboard-pill" onClick={run}>
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
