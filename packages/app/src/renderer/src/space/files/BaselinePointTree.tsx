import {
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BaselinePoint, BaselineRow } from '../../../../shared/ipc/space/roots.types.js';
import {
  COMMIT_MISSING_TEXT,
  POINT_KIND_LABEL,
  type PickerItem,
  describePoint,
  formatAt,
  isChoosable,
  pickerItems,
  shortSha,
} from './baselinePickerModel.js';

export type BaselinePointTreeProps = {
  rows: readonly BaselineRow[];
  /** The key (`pointKey`) of the point the root's baseline is at now, or `null`. */
  selectedId: string | null;
  /** Whether choosing is refused for now (a choice is being applied). */
  busy: boolean;
  onChoose: (point: BaselinePoint) => void;
};

/**
 * The baseline points of a root, newest first, as a tree: points stand alone,
 * and the session closes and commits of a session are grouped under a header
 * that collapses. Keyboard: Up and Down move, Home and End go to the ends,
 * Right opens a group, Left closes it or goes to its header, Enter or Space
 * chooses a point or opens and closes a group, a letter goes to the next line
 * whose words start with it.
 */
export function BaselinePointTree({
  rows,
  selectedId,
  busy,
  onChoose,
}: BaselinePointTreeProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo(() => pickerItems(rows, collapsed), [rows, collapsed]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const active =
    items.find((item) => item.id === activeId) ??
    items.find((item) => item.id === selectedId) ??
    items[0];
  const activeDomId = active === undefined ? undefined : domId(active.id);

  useEffect(() => {
    treeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (activeDomId === undefined) return;
    document.getElementById(activeDomId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeDomId]);

  /** A click on a line: the tree takes it, as it takes the keys. */
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const line = (event.target as HTMLElement).closest('[data-item-id]');
    const item = items.find((candidate) => candidate.id === line?.getAttribute('data-item-id'));
    if (item !== undefined) activate(item);
  };

  const toggle = (sessionId: string, open?: boolean): void => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      const isOpen = !next.has(sessionId);
      if (open ?? !isOpen) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const activate = (item: PickerItem): void => {
    setActiveId(item.id);
    if (item.kind === 'session') toggle(item.sessionId);
    else if (!busy && isChoosable(item.point)) onChoose(item.point);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (active === undefined) return;
    const index = items.indexOf(active);
    const move = (to: number): void => {
      const item = items[Math.max(0, Math.min(items.length - 1, to))];
      if (item !== undefined) setActiveId(item.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(items.length - 1);
        break;
      case 'ArrowRight':
        if (active.kind === 'session' && !active.expanded) toggle(active.sessionId, true);
        else if (active.kind === 'session') move(index + 1);
        break;
      case 'ArrowLeft':
        if (active.kind === 'session' && active.expanded) toggle(active.sessionId, false);
        else if (active.kind === 'point' && active.sessionId !== undefined) {
          setActiveId(`session:${active.sessionId}`);
        }
        break;
      case 'Enter':
      case ' ':
        activate(active);
        break;
      default: {
        // Typeahead: a letter moves to the next line whose words start with it.
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const letter = event.key.toLowerCase();
        const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
        const next = ordered.find((item) => itemWords(item).toLowerCase().startsWith(letter));
        if (next === undefined) return;
        setActiveId(next.id);
      }
    }
    event.preventDefault();
  };

  if (items.length === 0) {
    return (
      <p style={emptyStyle} data-testid="files-baseline-empty">
        This root has no baseline points yet.
      </p>
    );
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Baseline points"
      aria-activedescendant={activeDomId}
      aria-busy={busy}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a tree is a composite widget; it takes the focus and names the active line through aria-activedescendant.
      tabIndex={0}
      style={treeStyle}
      onKeyDown={onKeyDown}
      onClick={onClick}
      data-testid="files-baseline-points"
    >
      {items.map((item) =>
        item.kind === 'session' ? (
          <div
            key={item.id}
            id={domId(item.id)}
            role="treeitem"
            aria-level={1}
            aria-expanded={item.expanded}
            aria-selected={false}
            style={{ ...rowStyle, ...(item.id === active?.id ? activeRowStyle : null) }}
            data-item-id={item.id}
            data-testid="files-baseline-session"
            data-session-id={item.sessionId}
          >
            <span style={caretStyle} aria-hidden="true">
              {item.expanded ? '▾' : '▸'}
            </span>
            <span style={kindStyle}>session</span>
            <span style={detailStyle}>{item.sessionId}</span>
            <span style={metaStyle}>
              {item.count === 1 ? '1 point' : `${item.count} points`}, {formatAt(item.at)}
            </span>
          </div>
        ) : (
          <PointRow
            key={item.id}
            itemId={item.id}
            point={item.point}
            level={item.level}
            selected={item.id === selectedId}
            active={item.id === active?.id}
          />
        ),
      )}
    </div>
  );
}

/** A line in words, as typeahead reads it: "session <id>" or the point described. */
function itemWords(item: PickerItem): string {
  return item.kind === 'session' ? `session ${item.sessionId}` : describePoint(item.point);
}

/** The id of a line in the document, for `aria-activedescendant`. */
function domId(id: string): string {
  return `baseline-item-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function PointRow({
  itemId,
  point,
  level,
  selected,
  active,
}: {
  itemId: string;
  point: BaselinePoint;
  level: 1 | 2;
  selected: boolean;
  active: boolean;
}): JSX.Element {
  const choosable = isChoosable(point);
  const name = choosable ? describePoint(point) : `${describePoint(point)}, ${COMMIT_MISSING_TEXT}`;
  return (
    <div
      id={domId(itemId)}
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-disabled={choosable ? undefined : true}
      aria-label={name}
      style={{
        ...rowStyle,
        ...(level === 2 ? nestedRowStyle : null),
        ...(selected ? selectedRowStyle : null),
        ...(active ? activeRowStyle : null),
        ...(choosable ? null : disabledRowStyle),
      }}
      data-item-id={itemId}
      data-testid="files-baseline-point"
      data-kind={point.kind}
      data-commit={point.commit}
    >
      <span style={kindStyle}>{POINT_KIND_LABEL[point.kind]}</span>
      <span style={detailStyle}>{pointDetail(point)}</span>
      <span style={metaStyle}>{choosable ? formatAt(point.at) : COMMIT_MISSING_TEXT}</span>
      {selected ? <span style={currentStyle}>current</span> : null}
    </div>
  );
}

/** What a row shows after the kind's label. */
function pointDetail(point: BaselinePoint): string {
  switch (point.kind) {
    case 'reviewed-mark':
      return shortSha(point.commit);
    case 'session-close':
      return point.engine === undefined
        ? shortSha(point.commit)
        : `${shortSha(point.commit)} engine ${point.engine}`;
    case 'merged-pull-request':
      return `#${point.number} ${point.title}`;
    case 'commit':
      return `${shortSha(point.commit)} ${point.subject}`;
  }
}

const treeStyle: React.CSSProperties = {
  maxHeight: '22rem',
  overflowY: 'auto',
  outline: 'none',
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  padding: '0.25rem 0.5rem',
  fontSize: '0.8rem',
  cursor: 'pointer',
  borderRadius: 4,
  color: 'var(--color-text)',
};

const nestedRowStyle: React.CSSProperties = { paddingLeft: '1.75rem' };

const activeRowStyle: React.CSSProperties = {
  outline: '1px solid var(--color-accent-border)',
  background: 'var(--color-hover)',
};

const selectedRowStyle: React.CSSProperties = { background: 'var(--color-accent-soft)' };

const disabledRowStyle: React.CSSProperties = { cursor: 'default', opacity: 0.6 };

const caretStyle: React.CSSProperties = { width: '0.75rem', color: 'var(--color-text-muted)' };

const kindStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.7rem',
  padding: '0 0.3rem',
  border: '1px solid var(--color-border)',
  borderRadius: 3,
  color: 'var(--color-text-secondary)',
};

const detailStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
};

const currentStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.7rem',
  color: 'var(--color-accent)',
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
};
