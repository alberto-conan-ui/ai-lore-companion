import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { defaultEngineId } from '../../components/tabKinds.js';
import { primaryButtonStyle } from '../styles.js';
import { AI_NO_ENGINE, AI_READINESS_CHECKING } from '../window/SpaceSessions.js';
import { useSpaceNavStore } from '../window/spaceNavStore.js';

const NOTE_ID = 'dashboard-start-session-note';

/**
 * Start a session from the Dashboard (phase M7.4, architecture document
 * section 5.11): Sessions is shown, an AI tab opens there and starts its
 * guarded session, as `+ AI` does. The engine is the registry's first, as for
 * `+ AI` with no engine chosen before. The action is enabled only while
 * `spaceSessionReadiness` answers ready; otherwise it is disabled and the
 * answer's sentence is shown under it.
 */
export function StartSession(): JSX.Element {
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [reason, setReason] = useState<string | undefined>(AI_READINESS_CHECKING);
  const startAiSession = useSpaceNavStore((state) => state.startAiSession);
  const engineId = defaultEngineId(engines, null);

  useEffect(() => {
    let live = true;
    void window.cockpit.enginesList().then((list) => {
      if (live) setEngines(list);
    });
    const off = window.cockpit.onEnginesChanged(setEngines);
    return () => {
      live = false;
      off();
    };
  }, []);

  const check = useCallback((): void => {
    if (engineId === '') {
      setReason(AI_NO_ENGINE);
      return;
    }
    void window.cockpit.spaceSessionReadiness({ engineId }).then((ready) => {
      setReason(ready.ok ? undefined : ready.error.message);
    });
  }, [engineId]);

  useEffect(() => {
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [check]);

  const engineName = engines.find((engine) => engine.id === engineId)?.name ?? engineId;
  return (
    <section style={sectionStyle} aria-label="Start a session" data-testid="dashboard-start">
      <button
        type="button"
        style={primaryButtonStyle}
        disabled={reason !== undefined}
        aria-describedby={NOTE_ID}
        onClick={() => startAiSession(engineId)}
        data-testid="dashboard-start-session"
      >
        Start a session
      </button>
      <p id={NOTE_ID} style={noteStyle} data-testid={NOTE_ID}>
        {reason ??
          `Opens an AI tab in Sessions and starts a ${engineName} session in Read only, with the write-guard of this Space.`}
      </p>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
