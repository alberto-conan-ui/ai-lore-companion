import { type JSX, type KeyboardEvent, useRef } from 'react';
import { SPACE_RAIL_ENTRIES, type SpaceRailEntryId, type SpaceScreenId } from './spaceNavStore.js';

type Props = {
  /** The screen the window shows; its entry is marked as the current one. */
  screen: SpaceScreenId;
  /** An entry was chosen, by click or by Enter or Space on it. */
  onSelect: (entry: SpaceRailEntryId) => void;
};

const ICONS: Record<SpaceRailEntryId, string> = {
  dashboard: '▦',
  sessions: '❯',
  files: '▤',
  search: '⌕',
};

/**
 * The rail of the Space window: Dashboard, Sessions, Files, Search. Every
 * entry is a button with its name as visible text. Tab reaches the rail, the
 * up and down arrows and Home and End move between its entries, and Enter or
 * Space chooses one. The entry of the screen that is shown carries
 * `aria-current="page"`. Files and Search are actions and are never current.
 */
export function SpaceRail({ screen, onSelect }: Props): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index === -1) return;
    const last = buttons.length - 1;
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, last)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target === -1) return;
    event.preventDefault();
    buttons[target]?.focus();
  };

  return (
    <nav style={railStyle} aria-label="Space" data-testid="space-rail">
      <ul ref={listRef} style={listStyle} onKeyDown={onKeyDown}>
        {SPACE_RAIL_ENTRIES.map((entry) => {
          const current = entry.kind === 'screen' && entry.id === screen;
          return (
            <li key={entry.id} style={itemStyle}>
              <button
                type="button"
                style={current ? currentEntryStyle : entryStyle}
                aria-current={current ? 'page' : undefined}
                data-testid={`space-rail-${entry.id}`}
                onClick={() => onSelect(entry.id)}
              >
                <span style={iconStyle} aria-hidden="true">
                  {ICONS[entry.id]}
                </span>
                <span>{entry.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const railStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '5.25rem',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-shell)',
  borderRight: '1px solid var(--color-border-rail)',
  overflowY: 'auto',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  margin: 0,
  padding: '6px 4px',
  listStyle: 'none',
};

const itemStyle: React.CSSProperties = { margin: 0, padding: 0 };

const entryStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  width: '100%',
  padding: '0.45rem 0.2rem',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: '5px',
  color: 'var(--color-text-soft)',
  font: 'inherit',
  fontSize: '0.72rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const currentEntryStyle: React.CSSProperties = {
  ...entryStyle,
  background: 'var(--color-rail-active)',
  border: '1px solid var(--color-rail-border)',
  color: 'var(--color-text-2)',
};

const iconStyle: React.CSSProperties = { fontSize: '1rem', lineHeight: 1 };
