import type { JSX, ReactNode } from 'react';
import { isChainErrorPayload } from '../../../shared/ipc.js';
import { accentColor, accentTint, hueFor, projectName } from '../projectAccent.js';
import { driftLevel, useCockpitStore } from '../store.js';
import { DriftPill } from './DriftPill.js';
import { ShortcutsMenu } from './ShortcutsMenu.js';

/** `search` is the global file-search, slotted into the middle of the header. */
export function TrackerStrip({ search }: { search?: ReactNode }): JSX.Element {
  const chain = useCockpitStore((s) => s.chain);
  const count = useCockpitStore((s) => s.entries.length);
  const level = driftLevel(count);

  if (!chain || isChainErrorPayload(chain)) {
    return (
      <header style={stripStyle}>
        <div style={{ color: '#aaa' }}>No active focus</div>
      </header>
    );
  }

  // The header wears the project's own hue — a tinted background and a bold top
  // stripe — and shows the project name in that hue. Windows for different
  // projects are then unmistakable at a glance.
  const name = projectName(chain.root);
  const hue = hueFor(name);
  const accent = accentColor(hue);
  const accentHeaderStyle: React.CSSProperties = {
    ...stripStyle,
    background: accentTint(hue),
    borderTop: `4px solid ${accent}`,
  };

  return (
    <header style={accentHeaderStyle}>
      <div style={topRowStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.9rem', minWidth: 0 }}>
          <span style={{ ...projectNameStyle, color: accent }} title={chain.root}>
            {name}
          </span>
          <ModeBadge mode={chain.mode} />
          <span style={focusTitle} title={chain.focus?.title ?? ''}>
            {chain.focus?.title ?? '—'}
          </span>
          {chain.activeChild ? (
            <>
              <Sep />
              <span style={activeChild} title={chain.activeChild.title}>
                {chain.activeChild.title}
              </span>
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <ShortcutsMenu />
          <FinderButton root={chain.root} />
          <DriftPill level={level} count={count} />
          <AckAllButton disabled={count === 0} />
        </div>
      </div>
      {search ? <div style={searchRowStyle}>{search}</div> : null}
    </header>
  );
}

function ModeBadge({ mode }: { mode: string }): JSX.Element {
  return (
    <span
      style={{
        padding: '0.18rem 0.5rem',
        borderRadius: '4px',
        background: '#1f2933',
        color: '#9ad0ff',
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {mode}
    </span>
  );
}

function Sep(): JSX.Element {
  return <span style={{ color: '#4a5762' }}>›</span>;
}

function FinderButton({ root }: { root: string }): JSX.Element {
  return (
    <button
      type="button"
      title="Open project folder in Finder"
      onClick={() => {
        void window.cockpit.openPath(root);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.3rem 0.6rem',
        background: 'transparent',
        color: '#9fb1bd',
        border: '1px solid #2f3a45',
        borderRadius: '4px',
        fontSize: '0.74rem',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      ↗ Finder
    </button>
  );
}

function AckAllButton({ disabled }: { disabled: boolean }): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="ack-all"
      onClick={() => {
        void window.cockpit.ackAll();
      }}
      style={{
        padding: '0.3rem 0.7rem',
        background: disabled ? '#2a323a' : '#3a78c2',
        color: disabled ? '#7a8590' : '#ffffff',
        border: 'none',
        borderRadius: '4px',
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      Ack all
    </button>
  );
}

const stripStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
  padding: '0.85rem 1rem',
  borderBottom: '1px solid #1f2933',
  background: '#0f1620',
};

/** Row one: mode badge, focus title, and the action buttons. */
const topRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
};

/** Row two: the global file search, spanning the full header width. */
const searchRowStyle: React.CSSProperties = {
  display: 'flex',
};

const projectNameStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: '0.95rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const focusTitle: React.CSSProperties = {
  fontWeight: 600,
  color: '#e6edf3',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const activeChild: React.CSSProperties = {
  color: '#9fb1bd',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
