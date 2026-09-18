import { useCallback, useState } from 'react';
import type { SpaceWindowResult } from '../../../shared/ipc.js';

/** What `useWindowRequest` gives a screen. */
export type WindowRequest = {
  /** Run a window channel. A refusal or a failure becomes `error`; choosing no folder is not an error. */
  run: (request: () => Promise<SpaceWindowResult>) => Promise<void>;
  /** True while a request is running; the screen disables its actions. */
  busy: boolean;
  /** The message of the last request that did not succeed, for the screen's error area. */
  error: string | null;
};

/**
 * Runs the window channels (`spaceOpenFolder`, `spaceNavigate`,
 * `spaceOpenInCockpit`) for a screen and keeps the message of a request that
 * did not succeed. The channels return a result and do not reject; a rejection
 * is still caught, so that the screen shows it.
 */
export function useWindowRequest(): WindowRequest {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (request: () => Promise<SpaceWindowResult>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      if (!result.ok && result.error.kind !== 'cancelled') setError(result.error.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error };
}
