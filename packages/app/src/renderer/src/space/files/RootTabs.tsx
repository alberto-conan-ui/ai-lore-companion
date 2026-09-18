import { type JSX, type KeyboardEvent, useRef } from 'react';
import type { RootSummary } from './filesTypes.js';

type Props = {
  roots: RootSummary[];
  selectedId: string | null;
  onSelect: (rootId: string) => void;
};

/** The id of the tab of a root and of its panel, for `aria-controls` and `aria-labelledby`. */
export const rootTabId = (rootId: string): string => `files-root-tab-${rootId}`;
export const rootPanelId = (rootId: string): string => `files-root-panel-${rootId}`;

/**
 * What a root's tab shows beside its name: the number of its changes against
 * its baseline, or why there is none. `label` is read by assistive technology.
 */
export function rootCount(summary: RootSummary): { text: string; label: string; title: string } {
  const { snapshot, root } = summary;
  switch (snapshot.status) {
    case 'ok': {
      const total = snapshot.changes.total;
      return {
        text: String(total),
        label: total === 1 ? '1 change' : `${total} changes`,
        title: `${total} changed against the baseline`,
      };
    }
    case 'unread':
      return { text: '…', label: 'changes not read yet', title: 'The changes are being read.' };
    case 'failed':
      return { text: '!', label: 'changes could not be read', title: snapshot.error.message };
    case 'untracked':
      return {
        text: '',
        label: 'not tracked by git',
        title: root.tracking.tracked ? snapshot.message : root.tracking.message,
      };
  }
}

/**
 * The roots of the Space as tabs, each named as the root is named, with the
 * count of its changes. Keyboard: the tabs are one stop of the Tab key; Left
 * and Right move between them, Home and End go to the first and the last, and
 * moving selects.
 */
export function RootTabs({ roots, selectedId, onSelect }: Props): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = roots.findIndex((summary) => summary.root.id === selectedId);
    if (index === -1) return;
    const last = roots.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % roots.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + roots.length) % roots.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target === -1) return;
    event.preventDefault();
    const next = roots[target];
    if (!next) return;
    onSelect(next.root.id);
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[target]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Roots"
      style={listStyle}
      onKeyDown={onKeyDown}
      data-testid="files-root-tabs"
    >
      {roots.map((summary) => {
        const { root } = summary;
        const selected = root.id === selectedId;
        const count = rootCount(summary);
        return (
          <button
            key={root.id}
            id={rootTabId(root.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={rootPanelId(root.id)}
            aria-label={`${root.name}, ${count.label}`}
            tabIndex={selected ? 0 : -1}
            title={count.title}
            style={selected ? selectedTabStyle : tabStyle}
            onClick={() => onSelect(root.id)}
            data-testid={`files-root-tab-${root.id}`}
            data-root-kind={root.kind}
          >
            <span style={nameStyle}>{root.name}</span>
            {count.text === '' ? null : (
              <span style={countStyle} data-testid={`files-root-count-${root.id}`}>
                {count.text}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem',
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid var(--color-border)',
};

const tabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.2rem 0.55rem',
  border: '1px solid transparent',
  borderRadius: '4px',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  font: 'inherit',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const selectedTabStyle: React.CSSProperties = {
  ...tabStyle,
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-rail-active)',
  color: 'var(--color-text-bright)',
};

const nameStyle: React.CSSProperties = { whiteSpace: 'nowrap' };

const countStyle: React.CSSProperties = {
  minWidth: '1.2rem',
  padding: '0 0.3rem',
  borderRadius: '999px',
  background: 'var(--color-border)',
  color: 'var(--color-text)',
  fontSize: '0.72rem',
  textAlign: 'center',
};
