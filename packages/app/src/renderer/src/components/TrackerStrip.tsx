import { type JSX, type ReactNode, useEffect, useState } from 'react';
import {
  type SettingsSnapshot,
  type ShortcutTarget,
  isChainErrorPayload,
} from '../../../shared/ipc.js';
import { accentColor, accentTint, hueFor, projectName } from '../projectAccent.js';
import { driftLevel, useCockpitStore } from '../store.js';
import { ACTION_BUTTON_HEIGHT } from './ActionButton.js';
import { DriftPill } from './DriftPill.js';
import { FocusView } from './FocusView.js';
import { RegisterChips } from './RegisterChips.js';
import { SettingsSheetModal, type SettingsSheetSection } from './SettingsSheet.js';
import { ShortcutButtons } from './ShortcutButtons.js';

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

  // The Settings sheet is opened from the macOS App menu's `Settings…` item
  // (or `⌘,`) via the `settings:open` push IPC. `initialSection` stays in the
  // type so a future entry point could deep-link a section.
  const [settingsSection, setSettingsSection] = useState<SettingsSheetSection | undefined>(
    undefined,
  );
  /** Pre-populates the add-shortcut form when Settings opens via a row's `+`. */
  const [draftTarget, setDraftTarget] = useState<ShortcutTarget | undefined>(undefined);
  const settingsOpen = settingsSection !== undefined;
  const closeSettings = (): void => {
    setSettingsSection(undefined);
    setDraftTarget(undefined);
  };

  useEffect(() => {
    return window.cockpit.onSettingsOpen(() => {
      setDraftTarget(undefined);
      setSettingsSection(null);
    });
  }, []);

  // The in-app focus view — opened by the small toggle button next to the
  // active-child title, closed by Escape or backdrop click.
  const [focusViewPath, setFocusViewPath] = useState<string | null>(null);

  const addShortcutFor = (target: ShortcutTarget): void => {
    setDraftTarget(target);
    setSettingsSection('shortcuts');
  };

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
        <RegisterChips
          posture={chain.posture}
          altitude={chain.dials?.altitude ?? null}
          commitment={chain.dials?.commitment ?? null}
          focusType={chain.focusType}
        />
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
        {chain.focus ? (
          <button
            type="button"
            data-testid="focus-view-toggle"
            title="Open focus view"
            onClick={() => setFocusViewPath(chain.activeChild?.path ?? chain.focus?.path ?? null)}
            style={focusViewToggleStyle}
          >
            ▾
          </button>
        ) : null}
      </div>
      {search ? (
        <div style={searchRowStyle} data-testid="header-search">
          {search}
        </div>
      ) : null}
      <div style={actionsBlockStyle} data-testid="header-actions">
        <div style={actionsSubRowStyle} data-testid="actions-row-project">
          <span style={rowLabelStyle}>Project</span>
          <ShortcutButtons row="project" />
          <AddShortcutButton
            testId="add-shortcut-project"
            onClick={() => addShortcutFor('project')}
          />
        </div>
        <div style={actionsSubRowStyle} data-testid="actions-row-lore">
          <span style={rowLabelStyle}>Lore</span>
          <ShortcutButtons row="lore" />
          <AddShortcutButton testId="add-shortcut-lore" onClick={() => addShortcutFor('lore')} />
          <div style={driftClusterStyle} data-testid="drift-cluster">
            <DriftPill level={level} count={count} />
            <AckAllButton disabled={count === 0} />
          </div>
        </div>
      </div>
      {settingsOpen ? (
        <SettingsSheetModal
          onClose={closeSettings}
          initialSection={settingsSection}
          initialDraftTarget={draftTarget}
        />
      ) : null}
      {focusViewPath ? (
        <FocusView path={focusViewPath} onClose={() => setFocusViewPath(null)} />
      ) : null}
    </header>
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

/** A compact `+` button that sits at the end of each shortcut row. Click
 *  opens the Settings sheet on the Shortcuts section with an add-shortcut
 *  draft pre-targeted at the row's target. */
function AddShortcutButton({
  onClick,
  testId,
}: {
  onClick: () => void;
  testId: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title="Add shortcut"
      onClick={onClick}
      style={addShortcutStyle}
    >
      +
    </button>
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

/** Row 3 — the action toolbar. Two sub-rows stacked vertically: the project
 *  row (folder shortcuts) on top, the other row (URL + terminal + drift
 *  cluster) below. Both wrap horizontally on overflow. Each row carries a
 *  min-height so an empty group still reserves space and the header layout
 *  stays stable. */
const actionsBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

const actionsSubRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem',
  minHeight: '1.85rem',
};

/** The left-aligned row label that names what each sub-row opens —
 *  "Project" / "Payload" / "Other". Sits at a fixed width so the buttons
 *  line up vertically across rows. */
const rowLabelStyle: React.CSSProperties = {
  width: '4.5rem',
  flexShrink: 0,
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#6c7783',
};

const addShortcutStyle: React.CSSProperties = {
  width: ACTION_BUTTON_HEIGHT,
  height: ACTION_BUTTON_HEIGHT,
  background: 'transparent',
  color: '#6c7783',
  border: '1px dashed #2f3a45',
  borderRadius: '5px',
  fontSize: '1rem',
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
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

const focusViewToggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.4rem',
  height: '1.4rem',
  marginLeft: '0.1rem',
  padding: 0,
  background: 'transparent',
  color: '#9fb1bd',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  fontSize: '0.78rem',
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
};
