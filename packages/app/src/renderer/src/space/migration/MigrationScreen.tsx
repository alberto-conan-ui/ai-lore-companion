import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';
import { folderPathStyle } from '../styles.js';
import { OpenInCockpitButton } from './OpenInCockpitButton.js';

type Props = { init: SpaceInitOf<'migration'> };

/**
 * The migration screen: what a folder that is an AI-Lore project of v0.8 or
 * older opens in. Placeholder until phase M6.5 builds the plan, the
 * confirmation and the "upgrade to v0.8 first" state (`init.legacy.migratable`
 * is false). M6.5 replaces this file, keeps the exported name and props, and
 * keeps `OpenInCockpitButton` on the screen.
 *
 * What it does already: it says what detection found, and it carries the
 * action "Open in the v0.8 cockpit".
 */
export function MigrationScreen({ init }: Props): JSX.Element {
  return (
    <Placeholder title="Migration from v0.8" phase="M6.5" id="migration">
      <p style={folderPathStyle} data-testid="migration-folder">
        {init.folder}
      </p>
      <p style={reasonStyle} data-testid="migration-reason">
        {init.legacy.reason}
      </p>
      <OpenInCockpitButton />
    </Placeholder>
  );
}

const reasonStyle: React.CSSProperties = {
  margin: '0 0 0.6rem',
  fontSize: '0.85rem',
  color: 'var(--color-text-secondary)',
};
