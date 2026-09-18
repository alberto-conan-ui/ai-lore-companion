/**
 * Path containment for the 1.0 library.
 *
 * Every path that comes from outside (the renderer, a session request, the
 * manifest, a v0.8 source) is joined to its base with `safeJoin`. Containment
 * is checked after symbolic links are resolved, never on the text of the path,
 * so a link inside the base that points outside it is refused.
 */

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';

/** The kinds of failure `safeJoin` and `isPathInside` return. */
export type PathFailureKind = 'invalid-path' | 'outside-base' | 'unresolvable-path';

/** A chain of symbolic links longer than this is treated as a loop. */
const MAX_LINK_DEPTH = 40;

/**
 * The real path of `path`, with symbolic links resolved. For a path that does
 * not exist yet, the real path of its nearest existing parent with the missing
 * part appended. A symbolic link whose target does not exist is followed to
 * where the target would be, so that a write through it is judged by its real
 * destination. Throws for an error other than "does not exist" (a link loop,
 * a folder that cannot be read); callers that guard a path treat a throw as a
 * refusal.
 */
export function realpathNearest(path: string): string {
  return resolveNearest(resolve(path), 0);
}

function resolveNearest(absolute: string, depth: number): string {
  if (depth > MAX_LINK_DEPTH) {
    throw new Error(`too many symbolic links while resolving ${absolute}`);
  }
  try {
    // The native form gives the spelling the filesystem holds. On a filesystem
    // that ignores case (the default on macOS) `Lore/x` and `lore/x` are one
    // file, and only the native form resolves both to the same text.
    return realpathSync.native(absolute);
  } catch (caught) {
    const code = errorCode(caught);
    // A name too long to exist is a missing name: the parent decides.
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') throw caught;
  }
  const linkTarget = danglingLinkTarget(absolute);
  if (linkTarget !== null) {
    return resolveNearest(resolve(dirname(absolute), linkTarget), depth + 1);
  }
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(resolveNearest(parent, depth), basename(absolute));
}

/** The target text of `absolute` when it is a symbolic link, otherwise `null`. */
function danglingLinkTarget(absolute: string): string | null {
  try {
    if (!lstatSync(absolute).isSymbolicLink()) return null;
    return readlinkSync(absolute);
  } catch {
    return null;
  }
}

/**
 * Whether `target` is `base` or a path below it, comparing the two texts as
 * given. It resolves no symbolic link; pass real paths (`realpathNearest`) when
 * the answer guards a read or a write.
 */
export function isInsideLexically(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target));
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * Whether `target` is `base` or a path below it after symbolic links are
 * resolved on both. Either path may not exist yet. A path that cannot be
 * resolved gives a failure, which a guard treats as a refusal.
 *
 * `..` segments are removed from the text before links are resolved, so the
 * answer is about `resolve(target)`. A caller that goes on to use the path
 * uses `resolve(target)` (or the value `safeJoin` returns), not the text it
 * was given: the operating system reads `link/../x` through the link.
 */
export function isPathInside(
  base: string,
  target: string,
): Result<boolean, Failure<PathFailureKind>> {
  try {
    return ok(isInsideLexically(realpathNearest(base), realpathNearest(target)));
  } catch (caught) {
    return fail('unresolvable-path', `cannot resolve ${target}: ${errorMessage(caught)}`);
  }
}

/**
 * Join `relativePath` to `base` and return the absolute result, or a failure
 * when the result is outside `base` after symbolic links are resolved on the
 * base and on the joined path (for a path that does not exist yet, on its
 * nearest existing parent). An absolute `relativePath` is accepted only when it
 * is inside `base`. The returned path is `resolve(base, relativePath)`: it
 * keeps the caller's spelling of `base` and is not replaced by the real path.
 */
export function safeJoin(
  base: string,
  relativePath: string,
): Result<string, Failure<PathFailureKind>> {
  if (base === '' || base.includes('\0') || relativePath.includes('\0')) {
    return fail('invalid-path', 'a path may not be empty or contain a NUL character');
  }
  const joined = resolve(base, relativePath);
  const inside = isPathInside(base, joined);
  if (!inside.ok) return inside;
  if (!inside.value) {
    return fail('outside-base', `${relativePath} is outside ${base}`);
  }
  return ok(joined);
}

/**
 * `target` relative to `base`, with `/` separators on every platform, as
 * records and manifests store paths. Both are compared as given.
 */
export function toPosixRelative(base: string, target: string): string {
  return relative(resolve(base), resolve(target)).split(sep).join('/');
}
