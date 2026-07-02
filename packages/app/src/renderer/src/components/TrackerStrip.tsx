import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { type SettingsSnapshot, isChainErrorPayload } from '../../../shared/ipc.js';
import { accentColor, accentTint, accentTintLight, hueFor, projectName } from '../projectAccent.js';
import { useCockpitStore } from '../store.js';
import { type ThemeSetting, onEffectiveTheme } from '../theme.js';
import { BaselinePicker } from './BaselinePicker.js';
import { BranchIndicators } from './BranchIndicators.js';
import { FocusView } from './FocusView.js';
import { SettingsSheetModal, type SettingsSheetSection } from './SettingsSheet.js';
import { ShapeChips } from './ShapeChips.js';

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
  // The effective theme drives the project-hue header tint (light vs dark).
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => onEffectiveTheme(setTheme), []);

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
    const off = window.cockpit.onSettingsOpen(() => {
      setSettingsSection(null);
    });
    // In-renderer signal — other components (e.g. AiTab's "+ Add engine…"
    // item) dispatch this to deep-link a Settings section without a main
    // round-trip. `detail.section` is one of `SettingsSheetSection`.
    const onOpenSection = (e: Event): void => {
      const detail = (e as CustomEvent<{ section: SettingsSheetSection }>).detail;
      setSettingsSection(detail?.section ?? null);
    };
    window.addEventListener('ai-lore:open-settings', onOpenSection);
    return () => {
      off();
      window.removeEventListener('ai-lore:open-settings', onOpenSection);
    };
  }, []);

  // The in-app focus view — opened by the small toggle button next to the
  // active-child title, closed by Escape or backdrop click.
  const [focusViewPath, setFocusViewPath] = useState<string | null>(null);

  if (!chain || isChainErrorPayload(chain)) {
    return (
      <header style={stripStyle}>
        <div style={{ color: 'var(--color-text-secondary)' }}>No active focus</div>
      </header>
    );
  }

  // The header wears the project's own hue — a tinted background and a bold top
  // stripe — and shows the project name in that hue. Windows for different
  // projects are then unmistakable at a glance.
  const name = projectName(chain.root);
  const hue = hueFor(name);
  const accent = accentColor(hue);
  const tint = theme === 'light' ? accentTintLight(hue) : accentTint(hue);
  const accentHeaderStyle: React.CSSProperties = showAccent
    ? { ...stripStyle, background: tint, borderTop: `4px solid ${accent}` }
    : stripStyle;

  const statusPath = `${chain.lorePath}/memory/status/status.index.md`;

  return (
    <header style={accentHeaderStyle}>
      <div style={identityRowStyle} data-testid="header-identity">
        <span
          style={{ ...projectNameStyle, color: showAccent ? accent : 'var(--color-text-bright)' }}
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
        {/* P5 chrome reshape: the posture/altitude/commitment/focus register
            chips were dropped — posture and dials are the verbs' to change,
            and FocusView still shows them read-only. The header now carries
            shell git state: both repos' branches. */}
        <BranchIndicators />
        <ShapeChips coreVersion={chain.coreVersion} shape={chain.shape} />
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
        {/* The save-point dropdown — the companion contribution the P5 chrome
            decision puts in the title bar (moved from the leftRail tab-strip).
            Its own marginLeft:auto pushes this right-side cluster over. */}
        <BaselinePicker />
        <ThemeToggle />
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
  return <span style={{ color: 'var(--color-text-faint)' }}>›</span>;
}

/**
 * The top-right theme switch — a three-state segmented control: ☾ dark ·
 * ◐ system (follow the OS) · ☀ light. Reflects the global `appearance.theme`
 * setting live and writes it on click; App resolves it (including `system`) and
 * applies `data-theme` to the document root, so the whole window re-themes.
 */
function ThemeToggle(): JSX.Element {
  const [setting, setSetting] = useState<ThemeSetting>('system');
  useEffect(() => {
    const apply = (snap: SettingsSnapshot): void => {
      const v = snap.resolved['appearance.theme'];
      setSetting(v === 'dark' || v === 'light' ? v : 'system');
    };
    void window.cockpit.settingsGet().then(apply);
    return window.cockpit.onSettingsChanged(apply);
  }, []);
  const choose = (value: ThemeSetting): void => {
    void window.cockpit.settingsSet({ tier: 'global', key: 'appearance.theme', value });
  };
  const seg = (value: ThemeSetting, glyph: string, label: string, first: boolean): JSX.Element => (
    <button
      type="button"
      data-testid={`theme-${value}`}
      title={label}
      aria-label={label}
      aria-pressed={setting === value}
      onClick={() => choose(value)}
      style={{
        ...(setting === value ? themeSegActiveStyle : themeSegStyle),
        ...(first ? null : { borderLeft: '1px solid var(--color-border-strong)' }),
      }}
    >
      {glyph}
    </button>
  );
  return (
    <div style={themeToggleGroupStyle}>
      {seg('dark', '☾', 'Dark theme', true)}
      {seg('system', '◐', 'Match system theme', false)}
      {seg('light', '☀', 'Light theme', false)}
    </div>
  );
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
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-header)',
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
  color: 'var(--color-text-bright)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const activeChild: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// No auto margin — the BaselinePicker before it owns the push-right; the row's
// gap separates the two.
const themeToggleGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  overflow: 'hidden',
  flexShrink: 0,
};
const themeSegStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.5rem',
  height: '1.35rem',
  padding: 0,
  background: 'transparent',
  color: 'var(--color-text-dim)',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.8rem',
  lineHeight: 1,
};
const themeSegActiveStyle: React.CSSProperties = {
  ...themeSegStyle,
  background: 'var(--color-selection)',
  color: 'var(--color-selection-fg)',
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
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  fontSize: '0.78rem',
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
};
