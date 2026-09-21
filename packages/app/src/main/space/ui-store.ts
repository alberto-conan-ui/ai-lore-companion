/**
 * What a Space's windows remember across a restart (phase M5.7), as a service
 * of the Space's context: one JSON file per concern under
 * `<userData>/spaces/<key>/ui/`.
 *
 * - Every file is `{ "version": 1, ... }`. A top-level field this build does
 *   not know is written back as it was read, because a development build and
 *   an installed build of different versions share the data folder.
 * - A write is atomic (core's `writeFileAtomicSync`) and comes a short time
 *   after the last save of the concern, so that a burst of changes is one
 *   write. What is pending is written when the Space closes.
 * - Only the instance that owns the desk writes. A second running instance
 *   reads, and every save it asks for is refused with `not-writable`.
 * - A file that is not JSON or not of its concern's shape is renamed to
 *   `<name>.corrupt-<time>`, and the window opens with defaults and a notice.
 *   A file with a higher `version` is left as it is, not read and not written.
 * - Nothing here is shared with a v0.8 project's files or the cockpit's
 *   settings file; everything is under `<userData>/spaces/<key>/ui/`.
 *
 * Which window may save is the caller's rule (`SpaceHost.mayRemember`): only
 * the focused window writes.
 */

import { lstatSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { confirmDeskOwnership, writeFileAtomicSync } from '@ai-lore-companion/core';
import { z } from 'zod';
import { defineSpaceService } from './context.js';
import { spaceDesk } from './desk-service.js';
import { spaceRootIdSchema } from './ipc/roots.js';
import { relativePathSchema } from './ipc/validate.js';

/** The file of each concern, inside `DeskPaths.ui`. */
export const UI_FILES = {
  'files-editor': 'files-editor.json',
  'selected-root': 'selected-root.json',
  baselines: 'baselines.json',
  'space-window': 'space-window.json',
  'files-window': 'files-window.json',
  'session-engine': 'session-engine.json',
  /** The per-Space profile (currently an engine-backed profile id) of the automatic PM session. */
  'pm-profile': 'pm-profile.json',
} as const;

export type UiConcern = keyof typeof UI_FILES;

/** The `version` this build writes. */
export const UI_VERSION = 1;

/** How long after the last save of a concern its file is written. */
export const UI_SAVE_DELAY_MS = 250;

/** The largest file that is read. The concerns are small; a larger file is not one of them. */
export const UI_FILE_SIZE_LIMIT = 1024 * 1024;

const version = z.literal(UI_VERSION);

const pinFields = {
  kind: z.enum(['reviewed-mark', 'merged-pull-request', 'session-close', 'commit']),
  commit: z.string().regex(/^[0-9a-fA-F]{7,64}$/),
  at: z.string().max(100),
  label: z.string().max(1000),
};

const pinSchema = z.looseObject(pinFields).nullable();

const docFields = {
  rootId: spaceRootIdSchema,
  path: relativePathSchema,
  oldPath: relativePathSchema.optional(),
  mode: z.enum(['code', 'preview', 'diff', 'at-commit']),
};

const docSchema = z.looseObject({
  ...docFields,
  pin: pinSchema,
  against: pinSchema,
  atCommit: pinSchema,
});

const strictPinSchema = z.strictObject(pinFields).nullable();

const rootBaselineSchema = z.string().regex(/^(?:HEAD|[0-9a-fA-F]{7,64})$/);

const boundsSchema = z.looseObject({
  version,
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(100).max(100_000),
  height: z.number().int().min(100).max(100_000),
});

/** The shape of each concern. Unknown fields pass, so that they are kept. */
export const UI_SCHEMAS = {
  'files-editor': z.looseObject({
    version,
    docs: z.array(docSchema).max(500),
    activeKey: z.string().max(5000).nullable(),
  }),
  'selected-root': z.looseObject({ version, rootId: spaceRootIdSchema.nullable() }),
  baselines: z.looseObject({
    version,
    roots: z.record(spaceRootIdSchema, rootBaselineSchema),
  }),
  'space-window': boundsSchema,
  'files-window': boundsSchema,
  'session-engine': z.looseObject({ version, engineId: z.string().min(1).max(256).nullable() }),
  'pm-profile': z.looseObject({ version, engineId: z.string().min(1).max(256).nullable() }),
} as const satisfies Record<UiConcern, z.ZodType>;

/**
 * The shape of a save the renderer asks for. Strict: a field this build does
 * not know is refused, so that nothing but the fields above (no file content,
 * no absolute path) reaches a file from the renderer. Fields a newer build
 * wrote are still kept, because a write merges into what the file holds.
 */
export const UI_SAVE_SCHEMAS = {
  'files-editor': z.strictObject({
    version,
    docs: z
      .array(
        z.strictObject({
          ...docFields,
          pin: strictPinSchema,
          against: strictPinSchema,
          atCommit: strictPinSchema,
        }),
      )
      .max(500),
    activeKey: z.string().max(5000).nullable(),
  }),
  'selected-root': z.strictObject({ version, rootId: spaceRootIdSchema.nullable() }),
  baselines: z.strictObject({ version, roots: z.record(spaceRootIdSchema, rootBaselineSchema) }),
} as const;

type JsonObject = Record<string, unknown>;

/** What reading a concern gives: the saved state, or `null` and why. */
export type UiReadResult = { state: JsonObject | null; notice: string | null };

export type UiSaveOutcome = 'scheduled' | 'not-writable';

export type SpaceUi = {
  /** The state of `concern`: what is pending, else what the file holds. */
  read(concern: UiConcern): UiReadResult;
  /** Save `state` (already of the concern's shape). The file is written after `UI_SAVE_DELAY_MS`. */
  save(concern: UiConcern, state: JsonObject): UiSaveOutcome;
  /** Write every pending concern now. */
  flush(): void;
};

type Held = SpaceUi & { dispose(): void };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

export const spaceUi = defineSpaceService<SpaceUi>({
  id: 'ui',
  create: (context): Held => {
    const { log } = context;
    const pending = new Map<UiConcern, JsonObject>();
    const timers = new Map<UiConcern, NodeJS.Timeout>();
    /** Concerns whose file a newer build wrote; this build leaves them alone. */
    const newer = new Set<UiConcern>();

    const pathOf = (concern: UiConcern): string => join(context.desk.ui, UI_FILES[concern]);

    /** Whether this instance owns the desk now. */
    const owns = (): boolean => {
      const opened = context.service(spaceDesk).open();
      if (!opened.ok || !opened.value.writable) return false;
      return confirmDeskOwnership(opened.value.paths.desk, opened.value.instance).ok;
    };

    /** The file's JSON object, `null` when there is none, or why it cannot be used. */
    const readRaw = (
      concern: UiConcern,
    ): { kind: 'none' } | { kind: 'ok'; data: JsonObject } | { kind: 'bad'; reason: string } => {
      const path = pathOf(concern);
      let text: string;
      try {
        const info = lstatSync(path);
        if (info.isSymbolicLink()) return { kind: 'bad', reason: 'it is a symbolic link' };
        if (!info.isFile()) return { kind: 'bad', reason: 'it is not a file' };
        if (info.size > UI_FILE_SIZE_LIMIT) return { kind: 'bad', reason: 'it is too large' };
        text = readFileSync(path, 'utf8');
      } catch (caught) {
        const code = (caught as { code?: unknown }).code;
        if (code === 'ENOENT') return { kind: 'none' };
        return { kind: 'bad', reason: caught instanceof Error ? caught.message : String(caught) };
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return { kind: 'bad', reason: 'it is not JSON' };
      }
      if (!isObject(data)) return { kind: 'bad', reason: 'it is not a JSON object' };
      return { kind: 'ok', data };
    };

    /** Rename a file that cannot be used, when this instance owns the desk. */
    const setAside = (concern: UiConcern, reason: string): string => {
      const path = pathOf(concern);
      const file = UI_FILES[concern];
      if (!owns()) {
        return `What this window remembered (${file}) could not be read (${reason}). It opens with defaults.`;
      }
      const aside = `${path}.corrupt-${stamp(new Date())}`;
      try {
        renameSync(path, aside);
      } catch {
        return `What this window remembered (${file}) could not be read (${reason}) nor set aside. It opens with defaults.`;
      }
      log.warn('ui-file-set-aside', { space: context.key, file, reason });
      return `What this window remembered (${file}) could not be read (${reason}). It was set aside as ${aside}, and the window opens with defaults.`;
    };

    const write = (concern: UiConcern): void => {
      const state = pending.get(concern);
      pending.delete(concern);
      const timer = timers.get(concern);
      if (timer) clearTimeout(timer);
      timers.delete(concern);
      if (state === undefined || newer.has(concern) || !owns()) return;
      // Fields of the file this build does not know are kept.
      const raw = readRaw(concern);
      const kept = raw.kind === 'ok' ? raw.data : {};
      if (typeof kept.version === 'number' && kept.version > UI_VERSION) {
        newer.add(concern);
        return;
      }
      const text = `${JSON.stringify({ ...kept, ...state, version: UI_VERSION }, null, 2)}\n`;
      const written = writeFileAtomicSync(pathOf(concern), text, { mode: 0o600, dirMode: 0o700 });
      if (!written.ok) {
        log.warn('ui-write-failed', { space: context.key, file: UI_FILES[concern] });
      }
    };

    const flush = (): void => {
      for (const concern of [...pending.keys()]) write(concern);
    };

    return {
      read(concern) {
        const held = pending.get(concern);
        if (held !== undefined) return { state: held, notice: null };
        const raw = readRaw(concern);
        if (raw.kind === 'none') return { state: null, notice: null };
        if (raw.kind === 'bad') return { state: null, notice: setAside(concern, raw.reason) };
        const found = raw.data.version;
        if (typeof found === 'number' && found > UI_VERSION) {
          newer.add(concern);
          return {
            state: null,
            notice: `What this window remembered (${UI_FILES[concern]}) was written by a newer build of the companion. It is left as it is, and the window opens with defaults.`,
          };
        }
        const parsed = UI_SCHEMAS[concern].safeParse(raw.data);
        if (!parsed.success) {
          return { state: null, notice: setAside(concern, 'it does not have the expected shape') };
        }
        return { state: parsed.data as JsonObject, notice: null };
      },
      save(concern, state) {
        if (newer.has(concern) || !owns()) return 'not-writable';
        pending.set(concern, state);
        const timer = timers.get(concern);
        if (timer) clearTimeout(timer);
        const next = setTimeout(() => write(concern), UI_SAVE_DELAY_MS);
        next.unref?.();
        timers.set(concern, next);
        return 'scheduled';
      },
      flush,
      dispose: flush,
    };
  },
  dispose: (service) => (service as Held).dispose(),
});
