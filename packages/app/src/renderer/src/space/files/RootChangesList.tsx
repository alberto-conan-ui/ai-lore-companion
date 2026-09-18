import {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RootChangeRow, RootChangesLine } from './rootChangesModel.js';

/** Every line of the list is this tall, so a line's offset is `index * LINE_HEIGHT`. */
const LINE_HEIGHT = 24;
/** Lines mounted above and below the visible window. */
const OVERSCAN = 10;

type Props = {
  lines: RootChangesLine[];
  /** The number of changes in `lines`. */
  changeCount: number;
  /** The path of the selected change, or `null`. */
  selectedPath: string | null;
  onSelect: (row: RootChangeRow) => void;
  /** Click or Space on a change: select it and reveal it in the tree. */
  onReveal: (row: RootChangeRow) => void;
  /** Double click or Enter on a change: open its diff. */
  onOpenDiff: (row: RootChangeRow) => void;
};

/**
 * The list of a root's changes: a listbox of the changes under the headings
 * `committed` and `uncommitted`. Only the lines in view are mounted, as the
 * v0.8 tree does, so a list of thousands of changes stays responsive. The
 * listbox holds the focus and names the selected change with
 * `aria-activedescendant`; Arrow keys, Home and End move the selection.
 */
export function RootChangesList({
  lines,
  changeCount,
  selectedPath,
  onSelect,
  onReveal,
  onOpenDiff,
}: Props): JSX.Element {
  const idBase = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 400);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight || 400));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** The line index of each change, in change order. */
  const changeLines = useMemo(() => {
    const out: number[] = [];
    lines.forEach((line, index) => {
      if (line.type === 'change') out.push(index);
    });
    return out;
  }, [lines]);

  const selectedLine = useMemo(() => {
    if (selectedPath === null) return -1;
    return lines.findIndex((line) => line.type === 'change' && line.row.path === selectedPath);
  }, [lines, selectedPath]);

  // Keep the selected change in view, so the element `aria-activedescendant` names is mounted.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || selectedLine < 0) return;
    const top = selectedLine * LINE_HEIGHT;
    const bottom = top + LINE_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    setScrollTop(el.scrollTop);
  }, [selectedLine]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rowAtLine = (lineIndex: number | undefined): RootChangeRow | null => {
        if (lineIndex === undefined) return null;
        const line = lines[lineIndex];
        return line?.type === 'change' ? line.row : null;
      };
      if (changeLines.length === 0) return;
      const at = changeLines.indexOf(selectedLine);
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowDown':
          next = at < 0 ? 0 : Math.min(changeLines.length - 1, at + 1);
          break;
        case 'ArrowUp':
          next = at < 0 ? 0 : Math.max(0, at - 1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = changeLines.length - 1;
          break;
        case 'Enter': {
          const row = rowAtLine(changeLines[at]);
          if (row) {
            event.preventDefault();
            onOpenDiff(row);
          }
          return;
        }
        case ' ': {
          const row = rowAtLine(changeLines[at]);
          if (row) {
            event.preventDefault();
            onReveal(row);
          }
          return;
        }
        default:
          return;
      }
      event.preventDefault();
      const row = rowAtLine(changeLines[next]);
      if (row) onSelect(row);
    },
    [changeLines, selectedLine, lines, onSelect, onReveal, onOpenDiff],
  );

  const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const end = Math.min(
    lines.length,
    Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT) + OVERSCAN,
  );
  const activeId =
    selectedLine >= 0 && selectedLine >= start && selectedLine < end
      ? `${idBase}-line-${selectedLine}`
      : undefined;

  return (
    <div
      ref={viewportRef}
      style={viewportStyle}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a <select> cannot mount only the rows in view. */}
      <div
        role="listbox"
        aria-label={`Changes, ${changeCount}`}
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ ...listStyle, height: `${lines.length * LINE_HEIGHT}px` }}
        data-testid="root-changes-list"
      >
        {lines.slice(start, end).map((line, offset) => {
          const index = start + offset;
          const top = index * LINE_HEIGHT;
          if (line.type === 'group') {
            return (
              <div
                key={`group-${line.state}`}
                aria-hidden="true"
                style={{ ...lineStyle, ...groupStyle, top }}
                data-testid={`root-changes-group-${line.state}`}
              >
                {line.state} <span style={groupCountStyle}>{line.count}</span>
              </div>
            );
          }
          const { row } = line;
          const selected = row.path === selectedPath;
          const label = `${row.kind} ${row.path}${row.oldPath ? ` from ${row.oldPath}` : ''}, ${row.state}`;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys (aria-activedescendant).
            <div
              key={`change-${row.path}`}
              id={`${idBase}-line-${index}`}
              // biome-ignore lint/a11y/useSemanticElements: an <option> lives only in a <select>, which cannot mount only the rows in view.
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              aria-label={label}
              aria-setsize={changeCount}
              aria-posinset={line.index + 1}
              title={label}
              style={{ ...lineStyle, ...(selected ? selectedStyle : null), top }}
              onClick={() => onReveal(row)}
              onDoubleClick={() => onOpenDiff(row)}
              data-testid="root-change"
              data-path={row.path}
              data-kind={row.kind}
              data-state={row.state}
            >
              <span style={{ ...kindStyle, color: KIND_COLOR[row.kind] }}>{row.kind}</span>
              <span style={pathStyle}>{row.path}</span>
              {row.oldPath ? <span style={fromStyle}>from {row.oldPath}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const KIND_COLOR: Record<RootChangeRow['kind'], string> = {
  added: 'var(--color-success)',
  changed: 'var(--color-warn)',
  deleted: 'var(--color-danger)',
  renamed: 'var(--color-accent, var(--color-warn))',
};

const viewportStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  position: 'relative',
  outlineOffset: '-2px',
};

const lineStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: `${LINE_HEIGHT}px`,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0 0.7rem',
  fontSize: '0.76rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  cursor: 'default',
  color: 'var(--color-text)',
};

const groupStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '0.7rem',
  letterSpacing: '0.04em',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-header)',
};

const groupCountStyle: React.CSSProperties = {
  fontWeight: 400,
  color: 'var(--color-text-muted)',
};

const selectedStyle: React.CSSProperties = {
  background: 'var(--color-selection, var(--color-border))',
  boxShadow: 'inset 3px 0 0 var(--color-text)',
};

const kindStyle: React.CSSProperties = {
  flex: '0 0 4.2rem',
  fontSize: '0.7rem',
  fontFamily: 'var(--font-mono, monospace)',
};

const pathStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const fromStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
