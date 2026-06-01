import type { CSSProperties, JSX } from 'react';
import { useXtermSession } from './useXtermSession.js';

/**
 * The AI Helper's **visible** session view (CR2) — a read-only xterm bound to
 * the helper PTY's id. The user watches the whole `claude` conversation here,
 * but can't type into it: turns are driven by the app from `main`. The PTY
 * lives in the window's terminal service and is killed when the window closes,
 * so this surface never owns its lifetime (`killOnUnmount: false`).
 */
export function HelperTerminal({ ptyId, active }: { ptyId: string; active: boolean }): JSX.Element {
  const { hostRef } = useXtermSession({ active, ptyId, readOnly: true, killOnUnmount: false });
  return <div ref={hostRef} style={hostStyle} data-testid="helper-terminal" />;
}

const hostStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};
