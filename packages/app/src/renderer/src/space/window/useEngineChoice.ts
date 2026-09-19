import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceEngineChoice } from '../../../../shared/ipc.js';

/** What `useEngineChoice` gives its caller. */
export type EngineChoiceState = {
  /** The engine choice of A.9, or `null` before the first answer arrives. */
  choice: SpaceEngineChoice | null;
  /** The message of a refused `spaceSessionEngines` call, or `null`. */
  error: string | null;
  /** Ask again. */
  refresh: () => void;
  /** Remember `engineId` for this Space, when it can start. */
  pick: (engineId: string) => void;
  /** Install the Lore again into Claude Code, then ask again. */
  reinstall: () => void;
};

/**
 * The engine choice of a Space session (architecture document A.9, phase
 * M9.7's `spaceSessionEngines`). Asks on mount, on window focus, on
 * `onEnginesChanged` (the registry changed in Settings), and on `refresh()`.
 * `pick` and `reinstall` call their own channels and adopt the choice they
 * answer with, so the caller does not have to `refresh()` itself.
 */
export function useEngineChoice(): EngineChoiceState {
  const [choice, setChoice] = useState<SpaceEngineChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const ask = useCallback((): void => {
    void window.cockpit.spaceSessionEngines({}).then((result) => {
      if (!live.current) return;
      if (result.ok) {
        setChoice(result.value);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }, []);

  useEffect(() => {
    ask();
    window.addEventListener('focus', ask);
    const off = window.cockpit.onEnginesChanged(() => ask());
    return () => {
      window.removeEventListener('focus', ask);
      off();
    };
  }, [ask]);

  const pick = useCallback((engineId: string): void => {
    void window.cockpit.spaceSessionEnginePick({ engineId }).then((result) => {
      if (!live.current) return;
      if (result.ok) {
        setChoice(result.value);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }, []);

  const reinstall = useCallback((): void => {
    void window.cockpit.spaceSessionReinstall({}).then((result) => {
      if (!live.current) return;
      if (result.ok) {
        setChoice(result.value);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }, []);

  return { choice, error, refresh: ask, pick, reinstall };
}
