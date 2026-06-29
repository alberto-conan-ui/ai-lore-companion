/**
 * The shell's contribution registry — the extension surface a consumer (the
 * AI-Lore **companion**) registers into at startup.
 *
 * This is the **shell layer**: by the boundary test — *"would this make sense
 * in an app that never heard of AI-Lore?"* — everything here is generic. The
 * shell owns the *mechanism* (a set of named extension points and a way to
 * register into them); it never names a concrete contribution. There are no
 * AI-Lore concepts in this file: no Memory, no save-point, no Pane, no import
 * from `@ai-lore-companion/core`. The dependency arrow is one-way —
 * **companion → shell** — and this file is the bottom of it.
 *
 * v2 P0 (boundary & foundations). Today only the `tabKinds` point is populated;
 * side panels, commands, and title-bar slots are declared but empty — a valid
 * state — and fill in as later phases (P2 docking, P5 chrome) extract.
 */

/**
 * A string-keyed registry of contributions of one kind. **Register-once**: a
 * duplicate id is a wiring bug (two consumers claiming the same slot), so it
 * throws rather than silently overwrite.
 */
export class Registry<T> {
  private readonly items = new Map<string, T>();

  register(id: string, item: T): this {
    if (this.items.has(id)) {
      throw new Error(`contribution "${id}" already registered`);
    }
    this.items.set(id, item);
    return this;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  values(): T[] {
    return [...this.items.values()];
  }

  /** Snapshot as a plain record keyed by id — for consumers that index by key
   *  (e.g. a tab dispatcher reading `kinds[tab.kind]`). */
  asRecord(): Record<string, T> {
    return Object.fromEntries(this.items);
  }
}

/**
 * The shell's contribution points, generic over the consumer's concrete payload
 * types. The shell fixes the *set* of extension points; the consumer supplies
 * the types and the values that fill them. A point with no contributions yet is
 * simply an empty registry.
 */
export type Contributions<TabKind, SidePanelView = never, Command = never, TitleBarSlot = never> = {
  /** Tab kinds a panel can host (terminal, browser, a companion pane, …). */
  readonly tabKinds: Registry<TabKind>;
  /** Views a consumer contributes into the shell's side panels. */
  readonly sidePanelViews: Registry<SidePanelView>;
  /** Invocable commands (palette / shortcuts). */
  readonly commands: Registry<Command>;
  /** Slots a consumer fills in the title bar (e.g. a save-point control). */
  readonly titleBarSlots: Registry<TitleBarSlot>;
};

/** Create an empty contribution container. The consumer registers into it at
 *  startup, then the shell reads it to build its chrome. */
export function createContributions<
  TabKind,
  SidePanelView = never,
  Command = never,
  TitleBarSlot = never,
>(): Contributions<TabKind, SidePanelView, Command, TitleBarSlot> {
  return {
    tabKinds: new Registry(),
    sidePanelViews: new Registry(),
    commands: new Registry(),
    titleBarSlots: new Registry(),
  };
}
