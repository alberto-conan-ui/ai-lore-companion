/**
 * The tab model of Sessions in a Space window, as functions from a list of
 * tabs to a list of tabs. They follow the rules the v0.8 cockpit applies to
 * its own tabs in `App.tsx` (titles, the running dot, a name set by hand), so
 * a tab behaves the same in both windows. The cockpit's code is not changed
 * and not imported: its rules are inside the `App` component, mixed with the
 * six panels of the cockpit. Sessions has one list.
 *
 * Every function returns the list it was given when nothing changes, so a
 * React state setter does not render again for it.
 */

import type { TerminalForegroundStatus } from '../../../../shared/ipc.js';
import type { WorkspaceTab } from '../../components/TabbedPanel.js';

/** How many tabs of `kind` the list holds, plus one: the number in `Shell 2`. */
export function nextIndexOf(tabs: readonly WorkspaceTab[], kind: WorkspaceTab['kind']): number {
  return tabs.filter((tab) => tab.kind === kind).length + 1;
}

function replaceTab(
  tabs: WorkspaceTab[],
  tabId: string,
  change: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceTab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  const current = tabs[index];
  if (current === undefined) return tabs;
  const changed = change(current);
  if (changed === current) return tabs;
  const next = [...tabs];
  next[index] = changed;
  return next;
}

/** Remove a tab. */
export function withoutTab(tabs: WorkspaceTab[], tabId: string): WorkspaceTab[] {
  return tabs.some((tab) => tab.id === tabId) ? tabs.filter((tab) => tab.id !== tabId) : tabs;
}

/** Appended to an unguarded AI tab's automatic title (M10.3). */
export const UNGUARDED_TITLE_SUFFIX = ' · unguarded';

/** A name set by hand is kept and stops the automatic title; an empty name returns to the automatic title. */
export function withTabRenamed(tabs: WorkspaceTab[], tabId: string, raw: string): WorkspaceTab[] {
  const name = raw.trim();
  return replaceTab(tabs, tabId, (tab) =>
    name === ''
      ? { ...tab, manualTitle: false, title: tab.baseTitle ?? tab.title }
      : { ...tab, manualTitle: true, title: name },
  );
}

/**
 * What the terminal of a tab reports: a shell tab shows the running command
 * as its title, an AI tab shows `<engine> · <status>`.
 */
export function withTerminalStatus(
  tabs: WorkspaceTab[],
  tabId: string,
  status: TerminalForegroundStatus,
  command: string,
  engineName: (engineId: string) => string,
): WorkspaceTab[] {
  return replaceTab(tabs, tabId, (tab) => {
    const automatic =
      tab.kind === 'ai'
        ? `${tab.engine ? engineName(tab.engine) : 'AI'} · ${status}${tab.unguarded ? UNGUARDED_TITLE_SUFFIX : ''}`
        : status === 'running' && command
          ? command
          : (tab.baseTitle ?? tab.title);
    const title = tab.manualTitle ? tab.title : automatic;
    return tab.status === status && tab.title === title ? tab : { ...tab, status, title };
  });
}

/** Another engine for an AI tab. */
export function withAiEngine(
  tabs: WorkspaceTab[],
  tabId: string,
  engineId: string,
  engineName: (engineId: string) => string,
): WorkspaceTab[] {
  return replaceTab(tabs, tabId, (tab) => {
    if (tab.kind !== 'ai' || tab.engine === engineId) return tab;
    const baseTitle = `AI (${engineName(engineId)})${tab.unguarded ? UNGUARDED_TITLE_SUFFIX : ''}`;
    return {
      ...tab,
      engine: engineId,
      baseTitle,
      title: tab.manualTitle ? tab.title : baseTitle,
    };
  });
}

/** An AI tab whose engine started or stopped: the title is the engine's name while it runs. */
export function withAiRunning(
  tabs: WorkspaceTab[],
  tabId: string,
  running: boolean,
  engineName: (engineId: string) => string,
): WorkspaceTab[] {
  return replaceTab(tabs, tabId, (tab) => {
    if (tab.kind !== 'ai') return tab;
    const name = tab.engine ? engineName(tab.engine) : '';
    const suffix = tab.unguarded ? UNGUARDED_TITLE_SUFFIX : '';
    const baseTitle = running ? `${name}${suffix}` : `AI (${name})${suffix}`;
    if (tab.baseTitle === baseTitle && (tab.manualTitle || tab.title === baseTitle)) return tab;
    return { ...tab, baseTitle, title: tab.manualTitle ? tab.title : baseTitle };
  });
}

/**
 * A session started unguarded (M10.3): the AI tab's title ends with
 * `UNGUARDED_TITLE_SUFFIX`, unless it was renamed by hand.
 */
export function withAiUnguarded(tabs: WorkspaceTab[], tabId: string): WorkspaceTab[] {
  return replaceTab(tabs, tabId, (tab) => {
    if (tab.kind !== 'ai' || tab.unguarded) return tab;
    const baseTitle = `${tab.baseTitle ?? tab.title}${UNGUARDED_TITLE_SUFFIX}`;
    return {
      ...tab,
      unguarded: true,
      baseTitle,
      title: tab.manualTitle ? tab.title : baseTitle,
    };
  });
}

/** Drop what a restored tab ran last, so the tab starts as a new one of its kind. */
export function withoutLastSession(tabs: WorkspaceTab[], tabId: string): WorkspaceTab[] {
  return replaceTab(tabs, tabId, (tab) => {
    if (!tab.lastSession) return tab;
    const { lastSession: _dropped, ...rest } = tab;
    return rest;
  });
}
