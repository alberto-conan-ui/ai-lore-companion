import { type JSX, useEffect, useState } from 'react';
import type {
  SpaceEngineChoice,
  SpaceEngineFix,
  SpaceEngineParam,
  SpaceLoreLine,
} from '../../../../shared/ipc.js';
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
  /** The ticked parameter texts of the chosen engine; `null` uses the defaults. */
  ticked: string[] | null;
  onTickedChange: (engineId: string, texts: string[]) => void;
};

/** The note while `spaceSessionEngines` has not answered yet. */
export const AI_READINESS_CHECKING = 'Checking whether an AI session can start in this Space.';

function engineName(choice: SpaceEngineChoice | null, engineId: string): string {
  return choice?.options.find((option) => option.engineId === engineId)?.name ?? engineId;
}

/** The texts of the parameters ticked by default: ticked on and not set by the companion. */
export function defaultParamTexts(params: readonly SpaceEngineParam[]): string[] {
  return params.filter((param) => param.defaultOn && param.effect !== 'refused').map((p) => p.text);
}

/** `Yes`, `Partly` or `No`, written out (M10.5, `m10-architecture.md` 3.6): the word is never colour alone. */
function loreWord(state: SpaceLoreLine['state']): string {
  return state === 'yes' ? 'Yes' : state === 'partly' ? 'Partly' : 'No';
}

/** `yes` when every line is `yes`; `no` when every line is `no`; `partly` otherwise. */
function overallLoreState(lines: readonly SpaceLoreLine[]): SpaceLoreLine['state'] {
  if (lines.every((line) => line.state === 'yes')) return 'yes';
  if (lines.every((line) => line.state === 'no')) return 'no';
  return 'partly';
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
  ticked,
  onTickedChange,
}: Props): JSX.Element {
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

  const chosenOption = choice?.options.find((option) => option.engineId === engineId) ?? null;
  const params = chosenOption?.params ?? [];
  const defaults = defaultParamTexts(params);
  const tickedTexts = ticked ?? defaults;
  const isTicked = (param: SpaceEngineParam): boolean =>
    param.effect !== 'refused' && tickedTexts.includes(param.text);
  const unguardedOptions = [
    ...new Set(
      params
        .filter((param) => isTicked(param) && param.effect === 'unguarded')
        .flatMap((p) => p.options),
    ),
  ];
  const isUnguarded = unguardedOptions.length > 0;

  // The readiness block (M10.5): the chosen option's `lore`, defensively — some fixtures
  // built before M10.5 give no `lore`, as some give no `params` (`?? []` above).
  const loreLines: SpaceLoreLine[] | null = chosenOption?.lore
    ? chosenOption.lore.lines.map((line) =>
        line.aspect === 'guard' && isUnguarded
          ? {
              aspect: line.aspect,
              state: 'no',
              text: `Unguarded: ${unguardedOptions.join(', ')} changes the guard.`,
            }
          : line,
      )
    : null;
  const overallLore = loreLines !== null ? overallLoreState(loreLines) : null;

  const buttonLabel =
    startingId !== null
      ? `Starting ${engineName(choice, startingId)}…`
      : isUnguarded
        ? `Start an unguarded ${choice?.buttonName ?? ''} session`
        : `Start a ${choice?.buttonName ?? ''} session`;

  const toggleParam = (param: SpaceEngineParam): void => {
    if (param.effect === 'refused' || engineId === null) return;
    const next = isTicked(param)
      ? tickedTexts.filter((text) => text !== param.text)
      : [...tickedTexts, param.text];
    onTickedChange(engineId, next);
  };

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
      case 'install-engine':
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
                  {option.lore
                    ? option.lore.asClaudeCode
                      ? ' — reads the Lore as Claude Code does'
                      : ' — reads the Lore partly'
                    : null}
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
      {chosenOption !== null ? (
        <div style={paramsWrapperStyle}>
          <h3 style={paramsHeadingStyle} data-testid={`${buttonTestId}-params`}>
            Parameters of {chosenOption.name}
          </h3>
          {params.length === 0 ? (
            <>
              <p style={paramsEmptyStyle}>
                {chosenOption.name} has no parameters. Add them in Settings, Engines.
              </p>
              <button
                type="button"
                style={linkButtonStyle}
                data-testid={`${buttonTestId}-params-edit`}
                onClick={() => useSpaceSettings.getState().open('engines')}
              >
                Edit parameters
              </button>
            </>
          ) : (
            <ul style={paramsListStyle}>
              {params.map((param, index) => (
                <li key={param.text} style={paramItemStyle}>
                  <label style={paramLabelStyle}>
                    <input
                      type="checkbox"
                      data-testid={`${buttonTestId}-param-${index}`}
                      checked={isTicked(param)}
                      disabled={param.effect === 'refused'}
                      onChange={() => toggleParam(param)}
                    />
                    <span style={paramTextStyle}>{param.text}</span>
                    {param.effect === 'unguarded' ? (
                      <span style={paramMutedStyle}> — changes the guard</span>
                    ) : null}
                    {param.effect === 'refused' ? (
                      <span style={paramMutedStyle}>
                        {' '}
                        — set by the companion; remove it in Settings
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {isUnguarded ? (
            <p style={unguardedNoteStyle} data-testid={`${buttonTestId}-unguarded-note`}>
              This session will be unguarded: {unguardedOptions.join(', ')} changes what it may do
              without asking you. Its tab and its Dashboard entry will say so.
            </p>
          ) : null}
        </div>
      ) : null}

      <p id={noteTestId} style={noteStyle} data-testid={noteTestId}>
        {noteText}
      </p>

      {loreLines !== null && overallLore !== null ? (
        <div style={loreWrapperStyle}>
          <p data-testid={`${buttonTestId}-lore`} data-state={overallLore} style={loreLineStyle}>
            Reads the Lore as Claude Code does: {overallLore}
          </p>
          <ul style={loreListStyle}>
            {loreLines.map((line) => (
              <li
                key={line.aspect}
                data-testid={`${buttonTestId}-lore-${line.aspect}`}
                data-state={line.state}
                style={loreLineStyle}
              >
                {loreWord(line.state)} — {line.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

const paramsWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.4rem',
  background: 'var(--color-inset)',
  borderRadius: '4px',
  border: '1px solid var(--color-border-2)',
};

const paramsHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--color-text)',
};

const paramsEmptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
};

const paramsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const paramItemStyle: React.CSSProperties = { display: 'block' };

const paramLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  fontSize: '0.78rem',
  color: 'var(--color-text)',
};

const paramTextStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const paramMutedStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
};

const unguardedNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-warn-fg)',
};

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

const loreWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const loreListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const loreLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
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
