/**
 * Argument, result and payload types of the channels of sessions (phase
 * M4.4). Plain data only. `shared/ipc.ts` already re-exports this file.
 */

/** Argument of `spaceSessionStart` and `spaceSessionReadiness`: an engine id of the registry. */
export type SpaceSessionEngineArg = { engineId: string };

/** Argument of `spaceSessionEnd`. */
export type SpaceSessionEndArg = { sessionId: string };

/** Why a session was not started, or cannot be. `message` can be shown to the Human Lead as it is. */
export type SpaceSessionFailure = {
  kind:
    | 'invalid-argument'
    | 'not-a-space-window'
    | 'no-terminal'
    | 'engine-not-found'
    | 'engine-not-supported'
    | 'python3-missing'
    | 'not-installed'
    | 'install-record-unreadable'
    | 'install-record-newer'
    | 'plugin-missing'
    | 'check-missing'
    | 'check-altered'
    | 'desk-unavailable'
    | 'session-server-unavailable'
    | 'session-files-failed'
    | 'start-failed'
    | 'unknown-session';
  message: string;
};

/**
 * A started session. `ptyId` is a terminal of the window's terminal service:
 * the existing terminal channels write to it, resize it and receive its exit.
 */
export type SpaceSessionStarted = { sessionId: string; ptyId: string; engineId: string };

export type SpaceSessionStartResult =
  | { ok: true; value: SpaceSessionStarted }
  | { ok: false; error: SpaceSessionFailure };

/** Whether a session can start now. A failure's `message` is the sentence for `aiUnavailableReason`. */
export type SpaceSessionReadinessResult =
  | { ok: true; value: { engineId: string } }
  | { ok: false; error: SpaceSessionFailure };

export type SpaceSessionEndResult =
  | { ok: true; value: { sessionId: string } }
  | { ok: false; error: SpaceSessionFailure };
