import type { HandoverParts } from '@ai-lore-companion/core';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { useRef, useState } from 'react';
import type { DashboardPanel, DashboardReportState } from '../../../../../shared/ipc.js';
import { ModalSheet } from '../../../components/overlay/ModalSheet.js';
import { relativeTime } from './format.js';
import { OverflowFooter, capItems } from './overflow.js';

export type HandoverEntry = {
  id: string;
  title: string;
  timestamp: string;
  path: string;
  parts: HandoverParts;
};

export type HandoversProps = {
  panels: readonly DashboardPanel[];
  reportState: DashboardReportState | null;
  now: number;
};

/** The handover column owns the selected entry and its sheet. */
export function Handovers({ panels, reportState, now }: HandoversProps): JSX.Element | null {
  const [openId, setOpenId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panel = panels.find(
    (candidate) => candidate.source === 'companion' && candidate.kind === 'handovers',
  );
  if (panel === undefined || panel.source !== 'companion') return null;
  const entries = (reportState?.context?.handovers ?? [])
    .map(toEntry)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const limit = Math.min(panel.limit ?? 5, 5);
  const ordered = panel.order === 'oldest' ? [...entries].reverse() : entries;
  const capped = capItems(ordered, limit);
  const visible = capped.visible;
  const latestId = entries[0]?.id;
  const selected = openId === null ? null : (entries.find((entry) => entry.id === openId) ?? null);

  return (
    <section className="dashboard-v2-handovers" aria-label="Handovers">
      <div style={headingStyle}>
        <h2 style={titleStyle}>{panel.title ?? 'HANDOVERS'}</h2>
        <span style={microStyle}>{entries.length} RECENT</span>
      </div>
      {visible.length === 0 ? (
        <p style={emptyStyle}>No handover has been written in this Space yet.</p>
      ) : (
        <div style={listStyle}>
          {visible.map((entry) => (
            <HandoverCard
              key={entry.id}
              entry={entry}
              latest={entry.id === latestId}
              now={now}
              onOpen={() => {
                returnFocus.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setOpenId(entry.id);
              }}
            />
          ))}
          <OverflowFooter hiddenCount={capped.hiddenCount} noun="handovers" />
        </div>
      )}
      {selected === null ? null : (
        <HandoverSheet
          entry={selected}
          onClose={() => {
            setOpenId(null);
            const target = returnFocus.current;
            window.setTimeout(() => target?.focus(), 0);
          }}
        />
      )}
    </section>
  );
}

export function HandoverCard({
  entry,
  latest,
  now,
  onOpen,
}: {
  entry: HandoverEntry;
  latest: boolean;
  now: number;
  onOpen: () => void;
}): JSX.Element {
  const headline =
    readableLine(firstRawLine(entry.parts.nextAction ?? entry.parts.text)) ??
    'No next action was recorded.';
  return (
    <button
      type="button"
      className="dashboard-v2-handover-card"
      style={cardStyle}
      onClick={onOpen}
      data-testid="handover-card"
    >
      {latest ? <span style={latestStyle}>● LATEST</span> : null}
      <span style={headlineStyle}>{headline}</span>
      <span style={metaStyle}>
        <span>{entry.title}</span>
        <time dateTime={entry.timestamp}>{relativeTime(entry.timestamp, now)}</time>
      </span>
    </button>
  );
}

export function HandoverSheet({
  entry,
  onClose,
}: { entry: HandoverEntry; onClose: () => void }): JSX.Element {
  const hasParts =
    entry.parts.nextAction !== null || entry.parts.done !== null || entry.parts.inProgress !== null;
  return (
    <ModalSheet
      label={`Handover — ${entry.title}`}
      onClose={onClose}
      testId="handover-sheet"
      backdropTestId="handover-sheet-backdrop"
      panelStyle={sheetStyle}
    >
      <div style={sheetHeadingStyle}>
        <h2 style={titleStyle}>{entry.title}</h2>
        <time dateTime={entry.timestamp} style={metaStyle}>
          {entry.timestamp}
        </time>
      </div>
      {hasParts ? (
        <>
          <HandoverSection heading="NEXT ACTION" value={entry.parts.nextAction} />
          <HandoverSection heading="WHAT HAPPENED" value={entry.parts.done} />
          <HandoverSection heading="WHERE THINGS STAND" value={entry.parts.inProgress} />
        </>
      ) : (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>NOTE</h3>
          <p style={fallbackStyle}>
            The three parts of this handover could not be read; the note is shown as written.
          </p>
          <MarkdownText value={entry.parts.text} />
        </section>
      )}
      <div style={footerStyle}>
        <button
          type="button"
          style={closeButtonStyle}
          onClick={onClose}
          data-testid="handover-sheet-close"
        >
          Close
        </button>
      </div>
    </ModalSheet>
  );
}

function HandoverSection({
  heading,
  value,
}: { heading: string; value: string | null }): JSX.Element | null {
  if (value === null) return null;
  return (
    <section style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>{heading}</h3>
      <MarkdownText value={value} />
    </section>
  );
}

function toEntry(
  entry: NonNullable<DashboardReportState['context']>['handovers'][number],
): HandoverEntry {
  return {
    id: entry.id,
    title: entry.title,
    timestamp: entry.timestamp,
    path: entry.path,
    parts: entry.parts,
  };
}

function firstRawLine(raw: string): string | null {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function readableLine(line: string | null): string | null {
  if (line === null) return null;
  let readable = line.trim();
  while (readable.startsWith('#')) readable = readable.slice(1).trim();
  if (readable.startsWith('- ')) readable = readable.slice(2).trim();
  readable = readable
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return readable.length === 0 ? null : readable;
}

/** Render the note's prose as semantic blocks; source HTML remains escaped text. */
function MarkdownText({ value }: { value: string }): JSX.Element {
  const blocks: ReactNode[] = [];
  const lines = value.split('\n');
  let cursor = 0;
  while (cursor < lines.length) {
    const start = cursor;
    const line = lines[cursor] ?? '';
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      cursor += 1;
      const code: string[] = [];
      while (cursor < lines.length && !/^\s*```/.test(lines[cursor] ?? '')) {
        code.push(lines[cursor++] ?? '');
      }
      cursor += 1;
      blocks.push(
        <pre key={`code-${start}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <h4 key={`heading-${start}`} style={subtleHeadingStyle}>
          {inlineText(heading[1] ?? '')}
        </h4>,
      );
      cursor += 1;
      continue;
    }
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(line)) {
      const ordered = /^\s*\d+[.)] /.test(line);
      const rows: ReactNode[] = [];
      while (cursor < lines.length) {
        const match = /^\s*(?:[-*+] |\d+[.)] )(.+)$/.exec(lines[cursor] ?? '');
        if (!match) break;
        rows.push(<li key={`line-${cursor}`}>{inlineText(match[1] ?? '')}</li>);
        cursor += 1;
      }
      blocks.push(
        ordered ? <ol key={`list-${start}`}>{rows}</ol> : <ul key={`list-${start}`}>{rows}</ul>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    cursor += 1;
    while (
      cursor < lines.length &&
      (lines[cursor] ?? '').trim() &&
      !/^\s*(?:#{1,6} |[-*+] |\d+[.)] |```)/.test(lines[cursor] ?? '')
    ) {
      paragraph.push(lines[cursor++] ?? '');
    }
    blocks.push(
      <p key={`paragraph-${start}`} style={{ margin: '6px 0' }}>
        {inlineText(paragraph.join('\n'))}
      </p>,
    );
  }
  return <div style={bodyStyle}>{blocks}</div>;
}

function inlineText(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > offset) nodes.push(value.slice(offset, at));
    const key = `token-${at}`;
    if (match[1] !== undefined) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<code key={key}>{match[2]}</code>);
    else {
      const url = match[4] ?? '';
      nodes.push(
        <a
          key={key}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            void window.cockpit.urlOpenExternal(url);
          }}
        >
          {match[3]}
        </a>,
      );
    }
    offset = at + match[0].length;
  }
  if (offset < value.length) nodes.push(value.slice(offset));
  return nodes;
}

const headingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
};
const titleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--d-text, #e6ebee)',
  fontSize: 'var(--d-size-title, 15px)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const microStyle: CSSProperties = {
  color: 'var(--d-muted-2, #4c555c)',
  fontSize: 'var(--d-size-micro, 10px)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const emptyStyle: CSSProperties = {
  margin: '1rem 0 0',
  color: 'var(--d-text-3, #8a949b)',
  fontSize: 'var(--d-size-body, 13px)',
};
const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 10,
};
const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 5,
  width: '100%',
  padding: '10px',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--d-radius)',
  background: 'var(--d-inset)',
  color: 'var(--d-text)',
  textAlign: 'left',
  cursor: 'pointer',
};
const latestStyle: CSSProperties = {
  color: 'var(--d-accent)',
  fontSize: 'var(--d-size-micro)',
  letterSpacing: '0.08em',
};
const headlineStyle: CSSProperties = {
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  color: 'var(--d-text)',
  fontSize: 'var(--d-size-title)',
  fontWeight: 600,
};
const metaStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  color: 'var(--d-muted-2, #4c555c)',
  fontSize: 'var(--d-size-small, 12px)',
};
const sheetStyle: CSSProperties = {
  top: '10vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(760px, 90vw)',
  maxHeight: '80vh',
  overflowY: 'auto',
  padding: '1rem 1.25rem',
  background: 'var(--d-panel, #0c1114)',
  border: '1px solid var(--d-border-strong, #1a2228)',
  borderRadius: 'var(--d-radius, 8px)',
  color: 'var(--d-text, #e6ebee)',
};
const sheetHeadingStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 14,
};
const sectionStyle: CSSProperties = { marginTop: 14 };
const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  color: 'var(--d-muted-2, #4c555c)',
  fontSize: 'var(--d-size-micro, 10px)',
  letterSpacing: '0.08em',
};
const subtleHeadingStyle: CSSProperties = {
  display: 'block',
  marginTop: 5,
  color: 'var(--d-text-2, #c2cad0)',
};
const bodyStyle: CSSProperties = {
  maxWidth: '68ch',
  margin: '5px 0 0',
  color: 'var(--d-text-2, #c2cad0)',
  fontSize: 'var(--d-size-body, 13px)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};
const fallbackStyle: CSSProperties = {
  margin: '5px 0 0',
  color: 'var(--d-muted, #616a71)',
  fontSize: 'var(--d-size-small, 12px)',
};
const closeButtonStyle: CSSProperties = {
  padding: '0.4rem 1rem',
  border: '1px solid var(--d-border-strong, #1a2228)',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--d-text-2, #c2cad0)',
  cursor: 'pointer',
};
const footerStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: 18 };
