import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';
import { folderPathStyle } from '../styles.js';

type Props = { init: SpaceInitOf<'space-files'> };

/**
 * The Files window of a Space: roots as tabs, the tree, the Changes panel, the
 * baseline picker, the editor. Placeholder until phase M5.2 builds its layout.
 * M5.2 replaces this file and keeps the exported name and props. `init.open`,
 * when given, is the root and the file to show; main sends a new `init` when
 * "Open in Files" is used while the window is open.
 */
export function FilesWindow({ init }: Props): JSX.Element {
  return (
    <Placeholder title="Files" phase="M5.2" id="space-files">
      <p style={folderPathStyle} data-testid="space-files-root">
        {init.space.root}
      </p>
    </Placeholder>
  );
}
