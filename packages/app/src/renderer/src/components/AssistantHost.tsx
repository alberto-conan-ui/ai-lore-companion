import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, useEffect, useState } from 'react';
import type { HelperPhase } from '../../../shared/ipc.js';
import { ActivityConsole } from './ActivityConsole.js';
import {
  buttonBusyStyle,
  buttonStyle,
  controlsStyle,
  engineSelectStyle,
  headerHintStyle,
  headerLabelStyle,
  headerStyle,
  isBusy,
  isConnected,
  isHelperCapable,
  paneStyle,
  sessionWrapStyle,
  statusLabel,
  statusStyle,
} from './assistantShared.js';

/**
 * The AI-assistant **host** (AI Helper, CR9) — the mid-pane tab where the
 * read-only helper session *lives*. The user clicks **Connect Assistant** here
 * to start the opt-in session; the app launches it (Claude as a visible,
 * input-locked read-only PTY shown below; Gemini headless with no terminal).
 *
 * This tab owns Connect + the engine pick + the live session. It produces no
 * answers of its own — the rendered output is the left-pane
 * {@link ./AssistantDashboard.tsx}, which rides the same Channel-C stream and
 * fires the first turn itself (the dashboard hydrate, which reads the lore and
 * so doubles as the orient). Splitting the two is the v1.0 "two-surface" shape.
 */
export function AssistantHost(_props: { active: boolean }): JSX.Element {
  const [phase, setPhase] = useState<HelperPhase | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  // The assistant-engine dropdown (CR7): the helper-capable engines and the one
  // picked for this project (persisted), defaulting to the first (Claude).
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [engineId, setEngineId] = useState<string | null>(null);

  // Load the engine choices + this project's persisted pick once.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, picked] = await Promise.all([
        window.cockpit.enginesList(),
        window.cockpit.helperEngineGet(),
      ]);
      if (!live) return;
      const capable = list.filter(isHelperCapable);
      setEngines(capable);
      setEngineId(picked ?? capable[0]?.id ?? null);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    return window.cockpit.onHelperEvent((event) => {
      setPhase(event.phase);
      if (event.ptyId) setPtyId(event.ptyId);
      setError(event.phase === 'error' ? (event.error ?? 'Something went wrong.') : '');
      // The first turn (the dashboard hydrate) is fired by the dashboard surface
      // on `ready`, not here — turns are serialized, so the host must not also
      // fire one or one of them would be dropped.
    });
  }, []);

  const connected = isConnected(phase, ptyId);
  const busy = isBusy(phase);

  const onConnect = (): void => {
    setError('');
    setPhase('connecting');
    void window.cockpit.helperConnect();
  };

  // Switch the assistant's engine (CR7): persist the choice for this project,
  // tear down the current session, and reset to disconnected so the next
  // Connect launches the newly-picked engine.
  const onEngineChange = async (id: string): Promise<void> => {
    if (!id || id === engineId) return;
    setEngineId(id);
    await window.cockpit.helperEngineSet(id);
    await window.cockpit.helperReset();
    setPhase(null);
    setPtyId(null);
    setError('');
  };

  return (
    <div style={paneStyle} data-testid="pane-assistant-host" data-pane="assistant-host">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>Assistant</span>
        <span style={headerHintStyle}>read-only · app-driven</span>
        {engines.length > 1 ? (
          <select
            style={engineSelectStyle}
            value={engineId ?? ''}
            onChange={(e) => void onEngineChange(e.target.value)}
            disabled={busy}
            data-testid="assistant-engine"
            title="Which AI runs the assistant (saved per project)"
          >
            {engines.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div style={controlsStyle}>
        {connected ? null : (
          <button
            type="button"
            style={{ ...buttonStyle, ...(phase === 'connecting' ? buttonBusyStyle : null) }}
            onClick={onConnect}
            disabled={phase === 'connecting'}
            data-testid="assistant-connect"
          >
            Connect Assistant
          </button>
        )}
        <span style={statusStyle} data-testid="assistant-host-status">
          {statusLabel(phase, connected)}
        </span>
      </div>

      {error ? (
        <div style={hostErrorStyle} data-testid="assistant-host-error">
          {error}
        </div>
      ) : null}

      {/* The assistant *is* a console: every action + its result stacks here,
          for both engines (Claude and Gemini ride the same event stream). */}
      <div style={sessionWrapStyle}>
        <ActivityConsole variant="full" />
      </div>
    </div>
  );
}

const hostErrorStyle: React.CSSProperties = {
  margin: '0 0.7rem 0.4rem',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--color-danger-fg)',
  whiteSpace: 'pre-wrap',
};
