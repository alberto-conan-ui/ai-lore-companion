/**
 * The shell's docking host — a generic, themed wrapper around Dockview (v2 P2).
 *
 * This is the **shell layer**: by the boundary test — *"would this make sense in
 * an app that never heard of AI-Lore?"* — a tabbed/dockable workspace is pure
 * commodity. There are no AI-Lore concepts here: no Memory, no save-point, no
 * Pane, no import from `@ai-lore-companion/core`. The shell owns *where* panels
 * dock; the consumer (the companion) supplies the panel/tab components and the
 * `onReady` wiring that seeds and persists the layout.
 *
 * Two things are fixed here so a consumer just mounts the host:
 *   - the base Dockview CSS and the `--color-*`→`--dv-*` token bridge are
 *     imported (the bridge class follows the app's light/dark switch on its own);
 *   - `renderer: 'always'` is the default, so a panel's DOM is kept mounted while
 *     its tab is inactive. That is load-bearing for stateful panes — a live PTY
 *     or a browser view must survive a tab switch, not be torn down (the v4
 *     default `onlyWhenVisible` would destroy it). The S0 spike proved Dockview
 *     re-parents (rather than remounts) a panel moved between groups; combined
 *     with `always`, a dragged terminal keeps its session.
 */
import 'dockview/dist/styles/dockview.css';
import './dockview-theme.css';

import { DockviewReact, type DockviewTheme, type IDockviewReactProps } from 'dockview';
import type { JSX } from 'react';

/**
 * The cockpit's Dockview theme. Its `className` is the token-bridge class defined
 * in `dockview-theme.css`; because the `--color-*` tokens it reads already flip
 * under `[data-theme="light"]`, this single theme follows the app's theme switch
 * with no light/dark branch here.
 */
export const AILORE_DOCKVIEW_THEME: DockviewTheme = {
  name: 'ailore',
  className: 'dockview-theme-ailore',
  // Drag overlay encompasses the panel content (not the whole group incl. tab
  // strip) — matches the cockpit's panel-scoped feel.
  dndPanelOverlay: 'content',
};

/**
 * Mount a themed Dockview. Forwards every `DockviewReact` prop; defaults the
 * theme to the cockpit's and the panel render mode to `always`. The host fills
 * its parent — give it a sized flex/grid container.
 */
export function DockHost(props: IDockviewReactProps): JSX.Element {
  return (
    <DockviewReact
      defaultRenderer="always"
      {...props}
      theme={props.theme ?? AILORE_DOCKVIEW_THEME}
    />
  );
}
