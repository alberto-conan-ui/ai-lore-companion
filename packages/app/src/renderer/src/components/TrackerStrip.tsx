import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { type SettingsSnapshot, isChainErrorPayload } from '../../../shared/ipc.js';
import { accentColor, accentTint, hueFor, projectName } from '../projectAccent.js';
import { driftLevel, useCockpitStore } from '../store.js';
import { ACTION_BUTTON_HEIGHT, ActionButton } from './ActionButton.js';
import { DriftPill } from './DriftPill.js';
import { SettingsButton, SettingsSheetModal, type SettingsSheetSection } from './SettingsSheet.js';
import { ShortcutsMenu } from './ShortcutsMenu.js';

/** `search` is the global file-search, slotted into the dedicated search row. */
export function TrackerStrip({ search }: { search?: ReactNode }): JSX.Element {
  const chain = useCockpitStore((s) => s.chain);
  const count = useCockpitStore((s) => s.entries.length);
  const level = driftLevel(count);

  // The header accent is a global / per-project setting — reflect it live.
  const [showAccent, setShowAccent] = useState(true);
  useEffect(() => {
    const apply = (snap: SettingsSnapshot): void => {
      setShowAccent(snap.resolved['appearance.showProjectAccent'] !== false);
    };
    void window.cockpit.settingsGet().then(apply);
    return window.cockpit.onSettingsChanged(apply);
  }, []);

  // The Settings sheet is opened from two places — the header gear (no section
  // preference) and the Shortcuts launcher's "Manage…" link (lands on the
  // Shortcuts section). The state is owned here so both can drive it.
  const [settingsSection, setSettingsSection] = useState<SettingsSheetSection | undefined>(
    undefined,
  );
  const settingsOpen = settingsSection !== undefined;
  const closeSettings = (): void => setSettingsSection(undefined);

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
  const accentHeaderStyle: React.CSSProperties = showAccent
    ? { ...stripStyle, background: accentTint(hue), borderTop: `4px solid ${accent}` }
    : stripStyle;

  return (
    <header style={accentHeaderStyle}>
      <div style={identityRowStyle} data-testid="header-identity">
        <span
          style={{ ...projectNameStyle, color: showAccent ? accent : '#e6edf3' }}
          title={chain.root}
        >
          {name}
        </span>
        <ModeBadge mode={chain.mode} />
        {chain.focus ? (
          <ChainLink path={chain.focus.path} style={focusTitle} testId="focus-link">
            {chain.focus.title}
          </ChainLink>
        ) : (
          <span style={focusTitle}>—</span>
        )}
        {chain.activeChild ? (
          <>
            <Sep />
            <ChainLink path={chain.activeChild.path} style={activeChild} testId="active-child-link">
              {chain.activeChild.title}
            </ChainLink>
          </>
        ) : null}
      </div>
      {search ? (
        <div style={searchRowStyle} data-testid="header-search">
          {search}
        </div>
      ) : null}
      <div style={actionsRowStyle} data-testid="header-actions">
        <SettingsButton onOpen={() => setSettingsSection(null)} />
        <ShortcutsMenu onManage={() => setSettingsSection('shortcuts')} />
        <FinderButton root={chain.root} />
        <div style={driftClusterStyle} data-testid="drift-cluster">
          <DriftPill level={level} count={count} />
          <AckAllButton disabled={count === 0} />
        </div>
      </div>
      {settingsOpen ? (
        <SettingsSheetModal onClose={closeSettings} initialSection={settingsSection} />
      ) : null}
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

/**
 * The focus / active-child title rendered as a button that opens its source
 * `.md` in the OS default app. Looks like text — no button chrome — with a
 * pointer cursor and an underline on hover, so identity stays the dominant
 * row but the affordance is obvious.
 */
function ChainLink({
  path,
  style,
  children,
  testId,
}: {
  path: string;
  style: React.CSSProperties;
  children: ReactNode;
  testId: string;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      title={`${path} — open in default app`}
      onClick={() => {
        void window.cockpit.openPath(path);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...style,
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textDecoration: hover ? 'underline' : 'none',
        textUnderlineOffset: '2px',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function FinderButton({ root }: { root: string }): JSX.Element {
  return (
    <ActionButton
      icon="↗"
      label="Finder"
      title="Open project folder in Finder"
      onClick={() => {
        void window.cockpit.openPath(root);
      }}
    />
  );
}

/**
 * `Ack all` is the action half of the drift cluster — filled blue CTA when
 * there is drift, dimmed when none. Its height matches the action buttons so
 * the toolbar reads as one bar.
 */
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
        height: ACTION_BUTTON_HEIGHT,
        padding: '0 0.75rem',
        background: disabled ? '#2a323a' : '#3a78c2',
        color: disabled ? '#7a8590' : '#ffffff',
        border: 'none',
        borderRadius: '5px',
        fontSize: '0.78rem',
        fontWeight: 600,
        lineHeight: 1,
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
  gap: '0.7rem',
  padding: '0.95rem 1rem 0.85rem',
  borderBottom: '1px solid #1f2933',
  background: '#0f1620',
};

/** Row 1 — identity & orientation. Roomier than the cramped current strip. */
const identityRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.9rem',
  minWidth: 0,
};

/** Row 2 — the global file search, spanning the full header width. */
const searchRowStyle: React.CSSProperties = {
  display: 'flex',
};

/** Row 3 — the action toolbar. One height across every control. */
const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

/** DriftPill + Ack all read as one unit — sit adjacent, separator-free. */
const driftClusterStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  marginLeft: 'auto',
};

const projectNameStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: '1.05rem',
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
