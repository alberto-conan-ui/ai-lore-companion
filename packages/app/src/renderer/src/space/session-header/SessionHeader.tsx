import type { WriteTarget } from '@ai-lore-companion/core';
import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import type { SpaceSessionHeader } from '../../../../shared/ipc.js';

type Props = {
  sessionId: string;
  /** The engine's name, from the engines registry. */
  engineName: string;
};

/** A target as the header names it: the kind as the desk names it, then its name and branch. */
export function targetLabel(target: WriteTarget): string {
  if (target.kind === 'lore') return 'lore';
  if (target.kind === 'publish-area') return `publish-area ${target.name}`;
  return `repository ${target.name}, branch ${target.branch}`;
}

/** The sentence Leave Writing leaves in the header: what it released. */
export function leftWritingSentence(released: readonly WriteTarget[]): string {
  if (released.length === 0) return 'Left Writing. The session held no target.';
  return `Left Writing. Released: ${released.map(targetLabel).join('; ')}.`;
}

const MODE_LABEL: Record<SpaceSessionHeader['mode'], string> = {
  'read-only': 'Read only',
  writing: 'Writing',
};

/**
 * The header of an AI tab in a Space window (phase M4.6): one line above the
 * terminal with the engine, the mode, the claimed targets with their branches
 * when in Writing, the item, and Leave Writing.
 *
 * The state comes from main: it is read once from the desk and then replaced
 * by each `onSpaceSessionHeader` push for this session, sent when the session
 * enters or leaves Writing. The header holds no mode of its own.
 *
 * Leave Writing asks for no confirmation: it only takes rights away. It says
 * what it released.
 */
export function SessionHeader({ sessionId, engineName }: Props): JSX.Element {
  const [header, setHeader] = useState<SpaceSessionHeader | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    const off = window.cockpit.onSpaceSessionHeader((next) => {
      if (next.sessionId !== sessionId) return;
      setHeader(next);
      setProblem(null);
    });
    void window.cockpit.spaceSessionHeader({ sessionId }).then((read) => {
      if (!live) return;
      if (read.ok) setHeader((current) => current ?? read.value);
      else setProblem(read.error.message);
    });
    return () => {
      live = false;
      off();
    };
  }, [sessionId]);

  const leave = (): void => {
    setLeaving(true);
    setNotice(null);
    void window.cockpit.spaceSessionLeaveWriting({ sessionId }).then((left) => {
      setLeaving(false);
      if (left.ok) {
        setNotice(leftWritingSentence(left.value.released));
        setHeader((current) =>
          current ? { ...current, mode: 'read-only', targets: [] } : current,
        );
      } else {
        setNotice(left.error.message);
      }
    });
  };

  const writing = header?.mode === 'writing';

  return (
    <section
      style={barStyle}
      aria-label="Session"
      data-testid="session-header"
      data-mode={header?.mode ?? ''}
    >
      <span style={engineStyle} data-testid="session-header-engine">
        {engineName}
      </span>
      {header ? (
        <span
          style={writing ? writingPillStyle : readOnlyPillStyle}
          data-testid="session-header-mode"
        >
          {MODE_LABEL[header.mode]}
        </span>
      ) : null}
      {header && header.unguarded.length > 0 ? (
        <span
          style={unguardedPillStyle}
          data-testid="session-header-unguarded"
          title={`Started with ${header.unguarded.join(', ')}: the companion's guard does not hold for this session.`}
        >
          Unguarded
        </span>
      ) : null}
      {writing && header ? (
        <ul style={chipsStyle} aria-label="Claimed targets" data-testid="session-header-targets">
          {header.targets.map((target) => (
            <li key={targetLabel(target)} style={chipStyle} data-testid="session-header-target">
              {targetLabel(target)}
            </li>
          ))}
        </ul>
      ) : null}
      {header?.item ? (
        <span style={metaStyle} title={header.item.url} data-testid="session-header-item">
          item {header.item.repository}#{header.item.number}
        </span>
      ) : null}
      <span style={metaStyle}>attended</span>
      {header?.closed ? (
        <span style={metaStyle} data-testid="session-header-closed">
          ended
        </span>
      ) : null}
      {problem ? (
        <span style={noticeStyle} role="alert" data-testid="session-header-problem">
          {problem}
        </span>
      ) : null}
      <output style={noticeStyle} aria-live="polite" data-testid="session-header-notice">
        {notice ?? ''}
      </output>
      {writing ? (
        <button
          type="button"
          style={leaveStyle}
          onClick={leave}
          disabled={leaving}
          data-testid="session-header-leave-writing"
        >
          Leave Writing
        </button>
      ) : null}
    </section>
  );
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem',
  flexShrink: 0,
  padding: '0.3rem 0.75rem',
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-shell)',
};

const engineStyle: CSSProperties = { fontWeight: 600, color: 'var(--color-text)' };

const pillBase: CSSProperties = {
  padding: '0.05rem 0.5rem',
  borderRadius: '999px',
  fontWeight: 600,
  border: '1px solid var(--color-border-strong)',
};

const readOnlyPillStyle: CSSProperties = { ...pillBase, color: 'var(--color-text)' };

const writingPillStyle: CSSProperties = {
  ...pillBase,
  color: 'var(--color-warn-fg)',
  background: 'var(--color-warn-bg)',
  border: '1px solid var(--color-warn)',
};

const unguardedPillStyle: CSSProperties = {
  ...pillBase,
  color: 'var(--color-danger-fg)',
  background: 'var(--color-danger-bg)',
  border: '1px solid var(--color-danger)',
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.35rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const chipStyle: CSSProperties = {
  padding: '0.05rem 0.45rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  color: 'var(--color-text)',
};

const metaStyle: CSSProperties = { color: 'var(--color-text-muted)' };

const noticeStyle: CSSProperties = { color: 'var(--color-text)' };

const leaveStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: '0.15rem 0.6rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  cursor: 'pointer',
};
