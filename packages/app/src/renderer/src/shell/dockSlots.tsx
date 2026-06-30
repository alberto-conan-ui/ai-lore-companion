/**
 * The content seam between Dockview and externally-owned, state-bearing DOM
 * (v2 P2). Shell-layer: it knows nothing of *what* is parked — by the boundary
 * test, "a panel whose body is a DOM element owned by someone else" is generic.
 *
 * Why this exists. The cockpit's live surfaces — a terminal's `xterm`/PTY, a
 * browser `WebContentsView` — must keep running when their tab is switched away
 * or dragged to another group. React would tear them down if the component
 * remounted, so today App keeps one **stable host `<div>` per tab**, portals the
 * React body into it, and `appendChild`s the host into whichever panel slot is
 * active. Dockview owns the panels now, so the "slot" each host parks into is a
 * Dockview panel's content element. A panel registers that element here by id;
 * the host's owner (App) reads the registry and parks its host into it. Combined
 * with Dockview's `renderer: 'always'` (see [DockHost](./DockHost.tsx)), an
 * inactive or moved panel keeps its DOM — and so its host keeps its PTY.
 */
import type { IDockviewPanelProps } from 'dockview';
import { type FC, type JSX, useEffect, useRef } from 'react';

/**
 * A registry of panel content elements keyed by slot id. A Dockview panel calls
 * `set` when it mounts (and `remove` when it unmounts); the element owner
 * `subscribe`s to re-park its hosts whenever the set of live slots changes.
 */
export class DockSlotRegistry {
  private readonly slots = new Map<string, HTMLElement>();
  private readonly listeners = new Set<() => void>();

  /** Register (or replace) the content element for `id`. */
  set(id: string, el: HTMLElement): void {
    if (this.slots.get(id) === el) return;
    this.slots.set(id, el);
    this.emit();
  }

  /** Drop `id`'s element — called when its panel unmounts. */
  remove(id: string): void {
    if (this.slots.delete(id)) this.emit();
  }

  get(id: string): HTMLElement | undefined {
    return this.slots.get(id);
  }

  /** Currently-live slot ids. */
  ids(): string[] {
    return [...this.slots.keys()];
  }

  /** Be told when the live slot set changes — returns an unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Params a slot panel carries — the id its content element registers under. */
export type DockSlotParams = { slotId: string };

const slotStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

/**
 * Build the Dockview panel component that backs every slotted tab. It renders an
 * empty, fill-the-panel `<div>` and registers it into `registry` under
 * `params.slotId`; the slot owner parks its state-bearing host there. One
 * component instance is reused for all slotted panels — Dockview supplies the
 * differing `params.slotId`.
 */
export function makeDockSlotPanel(
  registry: DockSlotRegistry,
): FC<IDockviewPanelProps<DockSlotParams>> {
  return function DockSlotPanel({ params }: IDockviewPanelProps<DockSlotParams>): JSX.Element {
    const ref = useRef<HTMLDivElement | null>(null);
    const { slotId } = params;
    // biome-ignore lint/correctness/useExhaustiveDependencies: `registry` is the factory's captured argument — stable for the component's life, never reactive; only a change of slotId should re-register.
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      registry.set(slotId, el);
      return () => registry.remove(slotId);
    }, [slotId]);
    return <div ref={ref} style={slotStyle} data-dock-slot={slotId} />;
  };
}
