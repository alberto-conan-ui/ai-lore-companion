/**
 * The read-only checks the steps' `isDone` share, and the result of a step
 * whose `run` is not built yet. Nothing here writes.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256File } from '../fs/copy-tree.js';
import { fail } from '../result.js';
import type { StepError } from '../steps/types.js';
import type { MigrationContext } from './context.js';

/** The kind of the result a step returns while its `run` is not built. */
export const STEP_NOT_BUILT = 'not-built-yet';

/** The result of a step whose `run` is not built yet (phase M6.2 leaves every `run` so). */
export function notBuiltYet(title: string): { ok: false; error: StepError } {
  return fail(
    STEP_NOT_BUILT,
    `The step "${title}" is not built yet in this version of the companion, so the migration stopped before it. Nothing of this step was done.`,
  );
}

/** The absolute path of a Space-relative path of the new Space. */
export function inSpace(ctx: MigrationContext, relative: string): string {
  return join(ctx.spaceRoot, ...relative.split('/'));
}

/** The absolute path of a source-relative path of the v0.8 project. */
export function inSource(ctx: MigrationContext, relative: string): string {
  return join(ctx.source.root, ...relative.split('/'));
}

/** Whether `path` is a file (a link is followed). */
export async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true;
}

/**
 * Whether the Space-relative `to` holds the same bytes as the source-relative
 * `from`. `sha256` is the hash the reader computed for `from`; when it is
 * `null` the source is hashed now. A file that cannot be read is not the same.
 */
export async function sameContent(
  ctx: MigrationContext,
  from: string,
  to: string,
  sha256: string | null,
): Promise<boolean> {
  const target = inSpace(ctx, to);
  if (!(await isFile(target))) return false;
  let expected = sha256;
  if (expected === null) {
    const hashed = await sha256File(inSource(ctx, from));
    if (!hashed.ok) return false;
    expected = hashed.value;
  }
  const actual = await sha256File(target);
  return actual.ok && actual.value === expected;
}

/** The text of a Space-relative file, or `null`. */
export async function spaceText(ctx: MigrationContext, relative: string): Promise<string | null> {
  return readFile(inSpace(ctx, relative), 'utf8').catch(() => null);
}

/** Whether a Space-relative file holds every one of `texts`. */
export async function spaceFileHolds(
  ctx: MigrationContext,
  relative: string,
  texts: readonly string[],
): Promise<boolean> {
  const text = await spaceText(ctx, relative);
  return text !== null && texts.every((wanted) => text.includes(wanted));
}
