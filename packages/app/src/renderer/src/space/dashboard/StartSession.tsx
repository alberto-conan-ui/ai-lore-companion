import type { JSX } from 'react';
import { EngineStartControl } from '../window/EngineStartControl.js';
import { useSpaceNavStore } from '../window/spaceNavStore.js';
import { useEngineChoice } from '../window/useEngineChoice.js';

type Props = {
  /** Whether the window's init carried `justCreated`: the Space just came out of setup. */
  justCreated?: boolean;
};

/**
 * Start a session from the Dashboard (architecture document A.9, M9.10): the
 * engine start control, naming the engine it starts and offering the fix for
 * every refusal. `onStart` shows Sessions, opens an AI tab there and starts
 * its guarded session, as `+ AI` does.
 */
export function StartSession({ justCreated }: Props): JSX.Element {
  const { choice, pick, reinstall, refresh } = useEngineChoice();
  const startAiSession = useSpaceNavStore((state) => state.startAiSession);
  const executionFlags = useSpaceNavStore((state) => state.executionFlags);
  const setExecutionFlags = useSpaceNavStore((state) => state.setExecutionFlags);

  return (
    <section style={sectionStyle} aria-label="Start a session" data-testid="dashboard-start">
      {justCreated === true ? (
        <p style={justCreatedStyle} data-testid="dashboard-just-created">
          The Space is ready. Start a session to begin work; it starts in Read only.
        </p>
      ) : null}
      <EngineStartControl
        choice={choice}
        onStart={startAiSession}
        onPick={pick}
        onReinstall={reinstall}
        onRefresh={refresh}
        menu="when-several"
        buttonTestId="dashboard-start-session"
        noteTestId="dashboard-start-session-note"
        menuTestId="dashboard-start-menu"
        flags={executionFlags}
        onFlagsChange={setExecutionFlags}
      />
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

const justCreatedStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-success-fg)',
  fontWeight: 600,
};
