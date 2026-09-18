import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';
import { folderPathStyle } from '../styles.js';

type Props = { init: SpaceInitOf<'setup'> };

/**
 * The create-a-Space screens: the form, the progress of the steps, a failed
 * step with "run again". Placeholder until phase M3.7 builds them. M3.7
 * replaces this file and keeps the exported name and props; its channels go in
 * `shared/ipc/space/setup.contract.ts`. `init.start` says how setup was
 * started; for `about-repository` main filled the folder and its origin.
 */
export function SetupScreen({ init }: Props): JSX.Element {
  return (
    <Placeholder title="Create a Space" phase="M3.7" id="setup">
      {init.start.kind === 'about-repository' && (
        <p style={folderPathStyle} data-testid="setup-about-folder">
          {init.start.folder}
        </p>
      )}
    </Placeholder>
  );
}
