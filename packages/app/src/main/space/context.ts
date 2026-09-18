/**
 * The Space context: what main holds for one open Space.
 *
 * There is one context per Space, not per window. The Space window and the
 * Files window of the same Space resolve to the same context. A context is
 * created when the first window of the Space opens and torn down when the last
 * one closes.
 *
 * A context holds a few fields from the start: the paths, the manifest, and
 * the PTY service of the Space window. Everything else a feature keeps per
 * Space (the roots and their tracker, the watchers, the desk store, the dialog
 * broker, the GitHub port, the refresh timer of the Project) is a service. A
 * phase defines its service in its own file with `defineSpaceService` and
 * reads it with `context.service(definition)`; the context builds it on first
 * use and disposes it at teardown. No phase edits this file to add one.
 */

import {
  type DeskPaths,
  type SpaceManifest,
  type SpacePaths,
  deskPaths,
  spaceKey,
  spacePaths,
} from '@ai-lore-companion/core';
import type { PtyService } from '../pty.js';
import type { SpaceLog } from './log.js';

/** A thing kept once per open Space, built on first use. */
export type SpaceServiceDefinition<T> = {
  /** A name that is unique among services, for the log: `roots`, `desk-store`, `dialog-broker`. */
  readonly id: string;
  /** Build the service. Called once per context, on the first `context.service(definition)`. */
  readonly create: (context: SpaceContext) => T;
  /** Stop timers, close watchers. Called at teardown, in the reverse of the order of creation. */
  readonly dispose?: (service: T) => void | Promise<void>;
};

/** Declare a service. The returned object is the key that `context.service` takes. */
export function defineSpaceService<T>(
  definition: SpaceServiceDefinition<T>,
): SpaceServiceDefinition<T> {
  return definition;
}

/** What main holds for one open Space. */
export type SpaceContext = {
  /** The key of the Space's desk: the SHA-1 of the Space folder's resolved path. */
  readonly key: string;
  /** The Space's folder, resolved. */
  readonly root: string;
  readonly paths: SpacePaths;
  /** The companion's data folder for this desk, under `<userData>/spaces/<key>/`. */
  readonly desk: DeskPaths;
  /** The manifest as it was last read. Replaced when a window of the Space is reloaded. */
  manifest: SpaceManifest;
  /**
   * The PTY service of the Space window, the one the existing terminal
   * channels use for that window. `null` while only the Files window is open.
   */
  ptyService: PtyService | null;
  /** The ids of the windows that show this Space. */
  readonly windowIds: ReadonlySet<number>;
  readonly log: SpaceLog;
  /** The service of `definition` for this Space, built now when it was not yet. */
  service<T>(definition: SpaceServiceDefinition<T>): T;
};

/** The contexts of the open Spaces. */
export type SpaceContextStore = {
  /** The context of the Space at `root` for window `windowId`, created when the Space had none. */
  acquire(arg: { root: string; manifest: SpaceManifest; windowId: number }): SpaceContext;
  /** The context the window shows, if it shows a Space. */
  forWindow(windowId: number): SpaceContext | undefined;
  /** The context of a Space by its key, if it is open. */
  forKey(key: string): SpaceContext | undefined;
  /** The window no longer shows its Space. The context is torn down when it was the last window. */
  release(windowId: number): Promise<void>;
  /** Tear down every context. Called when the app quits. */
  releaseAll(): Promise<void>;
};

type Held = {
  context: SpaceContext;
  windowIds: Set<number>;
  /** Services in the order they were created. */
  services: { definition: SpaceServiceDefinition<unknown>; service: unknown }[];
};

/** Build the store of contexts. `userDataDir` is a function because it is known only once the app is ready. */
export function createSpaceContextStore(options: {
  userDataDir: () => string;
  log: SpaceLog;
}): SpaceContextStore {
  const { log } = options;
  const byKey = new Map<string, Held>();
  const keyByWindow = new Map<number, string>();

  const teardown = async (held: Held): Promise<void> => {
    byKey.delete(held.context.key);
    for (const { definition, service } of [...held.services].reverse()) {
      try {
        await definition.dispose?.(service);
      } catch (caught) {
        log.warn('space-service-dispose-failed', {
          space: held.context.key,
          service: definition.id,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }
    held.services.length = 0;
    log.info('space-context-closed', { space: held.context.key, root: held.context.root });
  };

  const create = (root: string, manifest: SpaceManifest): Held => {
    const key = spaceKey(root);
    const windowIds = new Set<number>();
    const services: Held['services'] = [];
    const context: SpaceContext = {
      key,
      root,
      paths: spacePaths(root),
      desk: deskPaths(options.userDataDir(), root),
      manifest,
      ptyService: null,
      windowIds,
      log,
      service<T>(definition: SpaceServiceDefinition<T>): T {
        const existing = services.find((entry) => entry.definition === definition);
        if (existing) return existing.service as T;
        if (services.some((entry) => entry.definition.id === definition.id)) {
          // Two definitions with one id would make the log ambiguous; it is a programming error.
          throw new Error(`space service id "${definition.id}" is defined twice`);
        }
        const service = definition.create(context);
        services.push({ definition: definition as SpaceServiceDefinition<unknown>, service });
        return service;
      },
    };
    return { context, windowIds, services };
  };

  return {
    acquire({ root, manifest, windowId }) {
      const key = spaceKey(root);
      let held = byKey.get(key);
      if (!held) {
        held = create(root, manifest);
        byKey.set(key, held);
        log.info('space-context-opened', { space: key, root });
      } else {
        held.context.manifest = manifest;
      }
      held.windowIds.add(windowId);
      keyByWindow.set(windowId, key);
      return held.context;
    },
    forWindow(windowId) {
      const key = keyByWindow.get(windowId);
      return key === undefined ? undefined : byKey.get(key)?.context;
    },
    forKey(key) {
      return byKey.get(key)?.context;
    },
    async release(windowId) {
      const key = keyByWindow.get(windowId);
      if (key === undefined) return;
      keyByWindow.delete(windowId);
      const held = byKey.get(key);
      if (!held) return;
      held.windowIds.delete(windowId);
      if (held.windowIds.size === 0) await teardown(held);
    },
    async releaseAll() {
      keyByWindow.clear();
      for (const held of [...byKey.values()]) {
        held.windowIds.clear();
        await teardown(held);
      }
    },
  };
}
