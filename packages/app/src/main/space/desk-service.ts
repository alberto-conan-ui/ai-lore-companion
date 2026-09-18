/**
 * The desk of an open Space, as a service of its context.
 *
 * The desk is opened once per Space, on first use, and given up when the last
 * window of the Space closes. Every part of main that reads or writes the
 * desk's records takes the desk from here, so one process opens it once. Added
 * by phase M4.3, which was the first part of the app to write the desk.
 */

import {
  type Desk,
  type DeskFailure,
  type Result,
  closeDesk,
  openDesk,
  repairSessionRecords,
} from '@ai-lore-companion/core';
import { defineSpaceService } from './context.js';

export type SpaceDesk = {
  /** The open desk. A failure is not kept: the next call tries again. */
  open(): Result<Desk, DeskFailure>;
};

type Held = SpaceDesk & { close(): void };

export const spaceDesk = defineSpaceService<SpaceDesk>({
  id: 'desk',
  create: (context): Held => {
    let desk: Desk | null = null;
    return {
      open() {
        if (desk) return { ok: true, value: desk };
        const opened = openDesk(context.desk);
        if (!opened.ok) {
          context.log.error('desk-open-failed', { space: context.key, kind: opened.error.kind });
          return opened;
        }
        desk = opened.value;
        context.log.info('desk-opened', { space: context.key, writable: desk.writable });
        if (desk.writable) {
          // Core asks for this when a desk is opened: a claim belongs to a session in Writing.
          const repaired = repairSessionRecords(desk);
          if (!repaired.ok) {
            context.log.warn('desk-repair-failed', {
              space: context.key,
              kind: repaired.error.kind,
            });
          }
        }
        return opened;
      },
      close() {
        if (!desk) return;
        const closed = closeDesk(desk);
        if (!closed.ok) {
          context.log.warn('desk-close-failed', { space: context.key, kind: closed.error.kind });
        }
        desk = null;
      },
    };
  },
  dispose: (service) => (service as Held).close(),
});
