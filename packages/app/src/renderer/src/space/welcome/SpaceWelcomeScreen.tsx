import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';
import { errorAreaStyle, primaryButtonStyle } from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';

type Props = { init: SpaceInitOf<'space-welcome'> };

/**
 * The 1.0 welcome screen: create a Space, open one from a folder or from a
 * GitHub address, the recents of Spaces (`init.recents`). Placeholder until
 * phase M3.6 builds it. M3.6 replaces this file and keeps the exported name
 * and props. The channels it needs exist: `spaceOpenFolder({})` asks for a
 * folder, `spaceOpenFolder({ folder })` opens a recent, `spaceNavigate` goes to
 * the machine check and to setup, `spaceRecentsRemove` drops a recent.
 *
 * What it does already: it opens a folder, so that the other 1.0 windows can
 * be reached, and it shows `init.notice`, the reason a launch folder was not
 * opened.
 */
export function SpaceWelcomeScreen({ init }: Props): JSX.Element {
  const { run, busy, error } = useWindowRequest();
  const message = error ?? init.notice ?? null;
  return (
    <Placeholder title="Welcome" phase="M3.6" id="space-welcome">
      <button
        type="button"
        style={{ ...primaryButtonStyle, marginTop: '0.6rem' }}
        disabled={busy}
        data-testid="space-welcome-open"
        onClick={() => void run(() => window.cockpit.spaceOpenFolder({}))}
      >
        Open a folder…
      </button>
      {message !== null && (
        <p style={errorAreaStyle} role="alert" data-testid="space-welcome-error">
          {message}
        </p>
      )}
    </Placeholder>
  );
}
