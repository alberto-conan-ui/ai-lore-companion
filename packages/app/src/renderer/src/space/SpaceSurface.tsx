import type { JSX } from 'react';
import type { SpaceWindowInitPayload } from '../../../shared/ipc.js';
import { SpaceSettings } from './SpaceSettings.js';
import { FilesWindow } from './files/FilesWindow.js';
import { MachineCheckScreen } from './machine/MachineCheckScreen.js';
import { MigrationScreen } from './migration/MigrationScreen.js';
import { NotASpaceScreen } from './not-a-space/NotASpaceScreen.js';
import { SetupScreen } from './setup/SetupScreen.js';
import { SpaceWelcomeScreen } from './welcome/SpaceWelcomeScreen.js';
import { SpaceWindow } from './window/SpaceWindow.js';

/**
 * The 1.0 surface: the screen of each 1.0 window mode. `App.tsx` renders it for
 * every mode of `SpaceWindowInitPayload` and knows nothing else about 1.0.
 *
 * Every mode has its screen file from phase M3.5 on. The phase that builds a
 * screen replaces that file and keeps its exported name and its `init` prop,
 * so this file and `App.tsx` are not edited again. The `key` makes a screen
 * start afresh when main sends the same mode a second time with other content.
 */
export function SpaceSurface({ init }: { init: SpaceWindowInitPayload }): JSX.Element {
  return (
    <>
      {screenFor(init)}
      <SpaceSettings />
    </>
  );
}

function screenFor(init: SpaceWindowInitPayload): JSX.Element {
  switch (init.mode) {
    case 'space-welcome':
      return <SpaceWelcomeScreen init={init} />;
    case 'machine-check':
      return <MachineCheckScreen init={init} />;
    case 'setup':
      return <SetupScreen key={init.start.kind} init={init} />;
    case 'migration':
      return <MigrationScreen key={init.folder} init={init} />;
    case 'not-a-space':
      return <NotASpaceScreen key={init.folder} init={init} />;
    case 'space':
      return <SpaceWindow key={init.space.root} init={init} />;
    case 'space-files':
      return <FilesWindow key={init.space.root} init={init} />;
  }
}
