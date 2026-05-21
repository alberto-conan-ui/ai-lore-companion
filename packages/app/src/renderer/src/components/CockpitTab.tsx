import type { ChainSuccess } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { Pane } from './Pane.js';

/** The cockpit tab body — the V2 dual pane, unchanged. The shared header
 *  (`TrackerStrip`) lives in the app shell, above the tab strip. */
export function CockpitTab({ chain }: { chain: ChainSuccess }): JSX.Element {
  return (
    <div style={panesRowStyle} data-testid="cockpit">
      <Pane scope="payload" label="Payload" rootPath={chain.root} projectRoot={chain.root} />
      <Pane
        scope="lore"
        label="Lore"
        rootPath={`${chain.lorePath}/memory`}
        projectRoot={chain.root}
      />
    </div>
  );
}

const panesRowStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};
