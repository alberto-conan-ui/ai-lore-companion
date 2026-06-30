/**
 * The host seam — the generic machinery that keeps a tab's live, state-bearing
 * DOM alive as it moves between containers (v2 P2). Shell-layer: by the boundary
 * test, "park externally-owned DOM into a slot resolved by id, and keep it alive
 * across moves" names no AI-Lore concept.
 *
 * The problem it solves (today's App.tsx, generalized). A tab's body — a
 * terminal's `xterm`/PTY, a browser `WebContentsView` — must not remount when the
 * tab is switched away or moved to another container, or the session dies. So
 * each tab gets one **stable host `<div>`** (created once, `data-tab-host=<id>`),
 * the React body is portaled into it, and the host is `appendChild`ed into
 * whichever *slot* element is currently active. Moving the tab moves the host
 * (a plain DOM reparent) without touching the React subtree.
 *
 * What varies between consumers is only **how a slot is resolved from an id**:
 * the v1.0 CSS-grid workspace resolves it from the per-panel content slots; the
 * Dockview workspace resolves it from a [DockSlotRegistry](./dockSlots.tsx). This
 * hook takes that resolver (plus a `slotsToken` that changes whenever slot
 * availability changes, so the parking re-runs) and owns everything else.
 */
import { type ReactNode, type ReactPortal, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** One seam-managed item: a stable id and whether its host should be shown. */
export type HostSeamItem = { id: string; visible: boolean };

/** Resolve the slot element an id's host should be parked into right now.
 *  Returning null/undefined leaves the host where it is until a slot appears. */
export type SlotResolver = (id: string) => HTMLElement | null | undefined;

/**
 * Manage the stable hosts + portals for `items`, parking each into the slot its
 * resolver returns and toggling visibility. Returns the portal nodes to render.
 *
 * @param items        the live items (id + visible), in any order
 * @param resolveSlot  where each id's host belongs now
 * @param renderBody   the React body to portal into id's host
 * @param slotsToken   any value that changes when slot availability changes —
 *                     drives a re-park (e.g. the panel `slots` state, or a
 *                     registry version bumped on `DockSlotRegistry.subscribe`)
 */
export function useHostSeam(
  items: HostSeamItem[],
  resolveSlot: SlotResolver,
  renderBody: (id: string) => ReactNode,
  slotsToken: unknown,
): ReactPortal[] {
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const getOrCreateHost = (id: string): HTMLDivElement => {
    let host = hostsRef.current.get(id);
    if (!host) {
      host = document.createElement('div');
      // The `data-tab-host` attribute is an e2e-pinned invariant: the
      // "survives being dragged between panels" test reads a host by this
      // attribute and asserts the *same* element persists across a move.
      host.dataset.tabHost = id;
      Object.assign(host.style, {
        flex: '1',
        minWidth: '0',
        minHeight: '0',
        display: 'none',
      });
      hostsRef.current.set(id, host);
    }
    return host;
  };

  // Park each host into its slot and toggle visibility, before paint so a move
  // doesn't flicker. Drop hosts for items that are gone. Re-runs when the items
  // or slot availability (`slotsToken`) change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slotsToken` is a deliberate re-park trigger — it isn't read in the body (the resolver is), but a change in slot availability is exactly when the parking must re-run.
  useLayoutEffect(() => {
    const alive = new Set(items.map((i) => i.id));
    for (const { id, visible } of items) {
      const host = hostsRef.current.get(id);
      if (!host) continue;
      const slot = resolveSlot(id);
      if (slot && host.parentNode !== slot) slot.appendChild(host);
      host.style.display = visible ? 'flex' : 'none';
    }
    for (const [id, host] of hostsRef.current) {
      if (!alive.has(id)) {
        host.remove();
        hostsRef.current.delete(id);
      }
    }
    // resolveSlot is read fresh each run; slotsToken is the re-park trigger.
  }, [items, slotsToken, resolveSlot]);

  return items.map(({ id }) => createPortal(renderBody(id), getOrCreateHost(id), id));
}
