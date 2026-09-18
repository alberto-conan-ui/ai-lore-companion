import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';
import { SpaceDialogs } from '../dialogs/SpaceDialogs.js';
import { folderPathStyle } from '../styles.js';

type Props = { init: SpaceInitOf<'space'> };

/**
 * The Space window: the header, the rail (Dashboard, Sessions, Files, Search),
 * and Sessions hosting the dock workspace. Placeholder until phase M3.8 builds
 * it. M3.8 replaces this file and keeps the exported name and props.
 *
 * Two mounts that M3.8 keeps, so that the phases that build them edit no file
 * of M3.8: `<SpaceDialogs />` once anywhere in the window (M4.5 builds it), and
 * `<Dashboard />` from `../dashboard/Dashboard.js` as the content of the
 * Dashboard entry of the rail (M7.3 builds it). The window already has a
 * terminal service in main: the existing terminal channels work here.
 * `spaceNavigate({ to: 'space-files' })` opens the Files window.
 */
export function SpaceWindow({ init }: Props): JSX.Element {
  return (
    <>
      <Placeholder
        title={init.space.name === '' ? 'Space' : init.space.name}
        phase="M3.8"
        id="space"
      >
        <p style={folderPathStyle} data-testid="space-root">
          {init.space.root}
        </p>
      </Placeholder>
      <SpaceDialogs />
    </>
  );
}
