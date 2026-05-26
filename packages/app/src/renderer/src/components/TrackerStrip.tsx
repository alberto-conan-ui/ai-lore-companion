import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { type SettingsSnapshot, isChainErrorPayload } from '../../../shared/ipc.js';
import { accentColor, accentTint, hueFor, projectName } from '../projectAccent.js';
import { useCockpitStore } from '../store.js';
import { FocusView } from './FocusView.js';
import { RegisterChips } from './RegisterChips.js';
import { SettingsSheetModal, type SettingsSheetSection } from './SettingsSheet.js';

/** `search` is the global file-search, slotted into the dedicated search row. */
export function TrackerStrip({ search }: { search?: ReactNode }): JSX.Element {
  const chain = useCockpitStore((s) => s.chain);

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
  const settingsOpen = settingsSection !== undefined;
  const closeSettings = (): void => {
    setSettingsSection(undefined);
  };

  useEffect(() => {
    return window.cockpit.onSettingsOpen(() => {
      setSettingsSection(null);
    });
  }, []);

  // The in-app focus view — opened by the small toggle button next to the
  // active-child title, closed by Escape or backdrop click.
  const [focusViewPath, setFocusViewPath] = useState<string | null>(null);

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

  const statusPath = `${chain.lorePath}/memory/status/status.index.md`;

  return (
    <header style={accentHeaderStyle}>
      <div style={identityRowStyle} data-testid="header-identity">
        <span
          style={{ ...projectNameStyle, color: showAccent ? accent : '#e6edf3' }}
          title={chain.root}
        >
          {name}
        </span>
        <button
          type="button"
          data-testid="status-view-toggle"
          title="Open status summary"
          onClick={() => setFocusViewPath(statusPath)}
          style={focusViewToggleStyle}
        >
          ▾
        </button>
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
      {/*
        v0.6 Phase A: the per-folder *Project* and *Lore* shortcut sub-rows
        were removed. Their concept moved into every file/folder context
        menu via the Apps catalog. The global drift cluster (Pill + Dismiss
        all) was removed in the same phase — the per-pane DriftPills and
        per-file glyphs already show drift where the user is acting; a
        passive global count adds nothing without a paired action.
      */}
      {settingsOpen ? (
        <SettingsSheetModal onClose={closeSettings} initialSection={settingsSection} />
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

// `AddShortcutButton` and `DismissAllButton` were removed in v0.6 Phase A —
// shortcuts moved into the Apps catalog + per-node context menus, and dismiss
// has no meaning in the git-as-truth model.

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
 *  cluster) below. Both wrap horizontally on overflow. */
// (v0.5 actionsBlockStyle / actionsSubRowStyle / rowLabelStyle / addShortcutStyle
// and the v0.6-introduced driftRowStyle / driftClusterStyle were all removed in
// v0.6 Phase A. Drift surfaces live per-pane / per-file now; the header carries
// only identity + search.)

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
