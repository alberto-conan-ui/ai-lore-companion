import { type JSX, useEffect, useState } from 'react';
import type { SpaceEngineChoice, SpaceEngineFix } from '../../../../shared/ipc.js';
import { PopoverShell } from '../../components/overlay/PopoverShell.js';
import { useSpaceSettings } from '../SpaceSettings.js';
import { CommandPanel } from '../common/CommandPanel.js';
import { bannerStyle, primaryButtonStyle, secondaryButtonStyle } from '../styles.js';

type Props = {
  choice: SpaceEngineChoice | null;
  onStart: (engineId: string) => void;
  onPick: (engineId: string) => void;
  onReinstall: () => void;
  onRefresh: () => void;
  /** Dashboard: the menu is shown only when two or more engines can start. Sessions: always. */
  menu: 'when-several' | 'always';
  /** 'dashboard-start-session' on the Dashboard, 'new-ai' in Sessions. */
  buttonTestId: string;
  /** 'dashboard-start-session-note' on the Dashboard, 'space-sessions-ai-note' in Sessions. */
  noteTestId: string;
  /** 'dashboard-start-menu' / 'space-sessions-engine-menu'. */
  menuTestId: string;
  flags?: string[];
  onFlagsChange?: (flags: string[]) => void;
};

/** The note while `spaceSessionEngines` has not answered yet. */
export const AI_READINESS_CHECKING = 'Checking whether an AI session can start in this Space.';

function engineName(choice: SpaceEngineChoice | null, engineId: string): string {
  return choice?.options.find((option) => option.engineId === engineId)?.name ?? engineId;
}

/**
 * The engine start control of architecture document A.9 and M9.10: a split
 * button ("Start a `<engine>` session" plus a `▾` menu of every engine and
 * why it cannot start), the note under it, and the card offering a fix when
 * no engine can start at all. Used by the Dashboard's `StartSession` and by
 * `SpaceSessions`' empty view and compact row.
 */
export function EngineStartControl({
  choice,
  onStart,
  onPick,
  onReinstall,
  onRefresh,
  menu,
  buttonTestId,
  noteTestId,
  menuTestId,
  flags = [],
  onFlagsChange,
}: Props): JSX.Element {
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [running, setRunning] = useState<SpaceEngineFix | null>(null);

  // A new choice (mount, window focus, the registry changing, or an explicit refresh) is the
  // signal that the attempt this control made is over one way or another; the AI tab itself
  // carries the authoritative "starting"/"started" state once it mounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `choice`'s identity is the trigger, not a value read in the effect.
  useEffect(() => {
    setStartingId(null);
  }, [choice]);

  const engineId = choice?.engineId ?? null;
  const startable = choice !== null && engineId !== null;
  const startableCount = choice?.options.filter((option) => option.canStart).length ?? 0;
  const showMenu = choice !== null && (menu === 'always' || startableCount >= 2);

  const buttonLabel =
    startingId !== null
      ? `Starting ${engineName(choice, startingId)}…`
      : `Start a ${choice?.buttonName ?? ''} session`;

  const noteText =
    choice === null
      ? AI_READINESS_CHECKING
      : choice.refusal !== null
        ? choice.refusal.message
        : `Starts ${engineName(choice, engineId ?? '')} in this Space's folder, in Read only. Writing needs your confirmation.`;

  const runFix = (fix: SpaceEngineFix): void => {
    setMenuOpen(false);
    switch (fix.kind) {
      case 'sign-in':
        setRunning(fix);
        return;
      case 'set-up-claude-code':
        void window.cockpit.spaceNavigate({ to: 'machine-check', section: 'engines' });
        return;
      case 'set-up-python3':
        void window.cockpit.spaceNavigate({ to: 'machine-check', section: 'tools' });
        return;
      case 'reinstall-lore':
        onReinstall();
        return;
      case 'edit-engine':
        useSpaceSettings.getState().open('engines');
        return;
    }
  };

  return (
    <div style={rootStyle}>
      <span style={splitStyle}>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={!startable || startingId !== null}
          aria-describedby={noteTestId}
          title={choice !== null && !startable ? noteText : undefined}
          data-testid={buttonTestId}
          onClick={() => {
            console.log('TRACE: EngineStartControl click', engineId);
            if (engineId === null) return;
            setStartingId(engineId);
            onStart(engineId);
          }}
        >
          {buttonLabel}
        </button>
        {showMenu && choice !== null ? (
          <PopoverShell
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align="end"
            label="Engines"
            testId={menuTestId}
            contentStyle={menuContentStyle}
            trigger={
              <button type="button" style={menuButtonStyle} aria-label="Choose the engine">
                ▾
              </button>
            }
          >
            {choice.options.map((option) =>
              option.canStart ? (
                <button
                  key={option.engineId}
                  type="button"
                  role="menuitem"
                  style={menuItemStyle}
                  data-testid={`${menuTestId}-option-${option.engineId}`}
                  onClick={() => {
                    setMenuOpen(false);
                    onPick(option.engineId);
                  }}
                >
                  {option.engineId === engineId ? '✓ ' : ''}
                  {option.name}
                </button>
              ) : (
                <div
                  key={option.engineId}
                  role="menuitem"
                  aria-disabled="true"
                  tabIndex={0}
                  style={menuItemDisabledStyle}
                  data-testid={`${menuTestId}-option-${option.engineId}`}
                >
                  <span>
                    {option.name} — {option.reason}
                  </span>
                  {option.fix !== null ? (
                    <button
                      type="button"
                      style={linkButtonStyle}
                      data-testid={`${menuTestId}-fix-${option.engineId}`}
                      onClick={() => runFix(option.fix as SpaceEngineFix)}
                    >
                      {option.fix.label}
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </PopoverShell>
        ) : null}
      </span>
      {onFlagsChange && (
        <div style={flagsWrapperStyle}>
          <button type="button" style={flagsToggleStyle} onClick={() => setFlagsOpen(!flagsOpen)}>
            {flagsOpen ? '▾' : '▸'} Settings
          </button>
          {flagsOpen && (
            <div style={flagsPanelStyle}>
              <label style={flagLabelStyle}>
                <input
                  type="checkbox"
                  checked={flags.includes('--dangerously-skip-permissions')}
                  onChange={(e) => {
                    if (e.target.checked) onFlagsChange([...flags, '--dangerously-skip-permissions']);
                    else onFlagsChange(flags.filter((f) => f !== '--dangerously-skip-permissions'));
                  }}
                />
                --dangerously-skip-permissions
              </label>
            </div>
          )}
        </div>
      )}

      <p id={noteTestId} style={noteStyle} data-testid={noteTestId}>
        {noteText}
      </p>

      {engineId === null && choice !== null && choice.refusal !== null ? (
        <div style={bannerStyle('warn')} data-testid={`${buttonTestId}-refusal`}>
          <strong style={refusalHeadingStyle}>No AI session can start yet</strong>
          {choice.refusal.fix !== null ? (
            <div style={refusalActionsStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                data-testid={`${buttonTestId}-fix`}
                onClick={() => runFix(choice.refusal?.fix as SpaceEngineFix)}
              >
                {choice.refusal.fix.label}
              </button>
              {choice.refusal.fix.commandLine !== null ? (
                <code style={commandLineStyle}>Runs: {choice.refusal.fix.commandLine}</code>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {running !== null ? (
        <CommandPanel
          commandId={running.commandId ?? ''}
          commandLine={running.commandLine ?? ''}
          onExit={() => onRefresh()}
          onClose={() => setRunning(null)}
        />
      ) : null}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

const splitStyle: React.CSSProperties = { display: 'inline-flex', gap: '0.3rem' };

const flagsWrapperStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };
const flagsToggleStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--color-text-soft)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left', padding: 0 };
const flagsPanelStyle: React.CSSProperties = { padding: '0.4rem', background: 'var(--color-inset)', borderRadius: '4px', border: '1px solid var(--color-border-2)' };
const flagLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--color-text)' };

const menuButtonStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  cursor: 'pointer',
};

// `PopoverShell`'s content is portalled straight to `document.body`, outside
// the screen's own root (where the app's font is set), so it never inherits
// it through the DOM. Setting it here, once, at the portal's root, is what
// every row below then picks up with `font: inherit`.
const menuContentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  minWidth: '18rem',
  padding: '0.4rem',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
};

const menuItemStyle: React.CSSProperties = {
  font: 'inherit',
  display: 'block',
  width: '100%',
  padding: '0.4rem 0.5rem',
  textAlign: 'left',
  fontSize: '0.82rem',
  color: 'var(--color-text)',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const menuItemDisabledStyle: React.CSSProperties = {
  font: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
};

const linkButtonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-link)',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const refusalHeadingStyle: React.CSSProperties = {
  fontSize: '0.88rem',
  color: 'var(--color-text-bright)',
};

const refusalActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const commandLineStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
};
