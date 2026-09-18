/**
 * The roots of a Space, resolved from its manifest: the Lore, the Workbench,
 * each publish area and each repository under `repos/`.
 *
 * A root that cannot be tracked is still a root. A missing folder, a folder
 * under `repos/` that is not a repository, a publish area this desk has no
 * path for: each is returned with `tracking.tracked` false and the reason, so
 * that the Files window can show the root and say why it has no changes.
 * `resolveRoots` fails only when the manifest itself cannot be read.
 */

import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { type GitPort, createGitPort, runGit } from '../exec/git-port.js';
import { type CommandRunner, commandFailure, runSucceeded } from '../exec/runner.js';
import { safeJoin, toPosixRelative } from '../fs/paths.js';
import { spacePaths } from '../layout/space-paths.js';
import {
  type ManifestFailureKind,
  type SpaceManifest,
  readSpaceManifest,
} from '../manifest/space-manifest.js';
import { type Failure, type Result, ok } from '../result.js';
import type { Root, RootKind, RootTracking, RootUntrackedReason } from './types.js';

/** The id of the Lore root. */
export const LORE_ROOT_ID = 'lore';

/** The id of the Workbench root. */
export const WORKBENCH_ROOT_ID = 'workbench';

/** What `resolveRoots` needs. */
export type ResolveRootsInput = {
  /** The Space's folder. */
  spaceRoot: string;
  /** Runs git. */
  runner: CommandRunner;
  /** The manifest, when the caller has already read it. Default: read from `lore/space.md`. */
  manifest?: SpaceManifest;
  /**
   * The folder of each publish area outside the Space, by name. The manifest
   * holds only the name of such an area; its path is personal to the desk, and
   * the caller passes what the desk has recorded. Each path is absolute.
   */
  outsidePublishAreas?: Readonly<Record<string, string>>;
};

/** The result of `resolveRoots`. It fails only when the manifest cannot be read. */
export type ResolveRootsResult = Result<Root[], Failure<ManifestFailureKind>>;

/** The id of the root of kind `kind` whose payload is named `name`. */
export function rootIdOf(kind: RootKind, name: string): string {
  if (kind === 'lore') return LORE_ROOT_ID;
  if (kind === 'workbench') return WORKBENCH_ROOT_ID;
  return kind === 'publish-area' ? `publish:${name}` : `repo:${name}`;
}

function untracked(reason: RootUntrackedReason, message: string): RootTracking {
  return { tracked: false, reason, message };
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The path the filesystem holds for `path`, or `path` itself when it cannot be resolved. */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** The top of the working tree that holds `path`, or the reason the root is not tracked. */
async function workTreeOf(
  git: GitPort,
  path: string,
  label: string,
): Promise<{ top: string } | { untracked: RootTracking }> {
  if (!isFolder(path)) {
    return { untracked: untracked('folder-missing', `${label} has no folder at ${path}.`) };
  }
  const top = await git.topLevel(path);
  if (!top.ok) return { untracked: untracked('git-failed', top.error.message) };
  if (top.value === null) {
    return {
      untracked: untracked('outside-a-repository', `${label} is not inside a git repository.`),
    };
  }
  return { top: top.value };
}

/** The tracking of a root that is a folder inside a working tree (or a whole working tree). */
async function trackFolder(
  runner: CommandRunner,
  git: GitPort,
  path: string,
  label: string,
): Promise<RootTracking> {
  const found = await workTreeOf(git, path, label);
  if ('untracked' in found) return found.untracked;
  const subPath = toPosixRelative(realPath(found.top), realPath(path));
  if (subPath === '') return { tracked: true, workTree: found.top, subPath: '' };
  if (subPath === '..' || subPath.startsWith('../')) {
    return untracked('git-failed', `${label} is not under the working tree git reports for it.`);
  }
  // The path goes on standard input, where git reads it as a plain path name.
  // `check-ignore` does not accept `--literal-pathspecs`, and an argument that
  // begins with `:` would be read as pathspec magic.
  const args = ['check-ignore', '-z', '--stdin'];
  const ignored = await runGit(runner, found.top, args, { readOnly: true, input: `${subPath}\0` });
  if (runSucceeded(ignored)) {
    return untracked('git-ignored', `${label} is ignored by git, so it has no change tracking.`);
  }
  if (ignored.failure !== undefined || ignored.code !== 1) {
    return untracked('git-failed', commandFailure('git', args, ignored).message);
  }
  return { tracked: true, workTree: found.top, subPath };
}

/** The tracking of a repository root: its folder must be the top of a working tree of its own. */
async function trackRepository(git: GitPort, path: string, label: string): Promise<RootTracking> {
  const found = await workTreeOf(git, path, label);
  if ('untracked' in found) {
    const reason = found.untracked.tracked ? null : found.untracked.reason;
    return reason === 'outside-a-repository'
      ? untracked('not-a-repository', `${label} is not a git repository.`)
      : found.untracked;
  }
  if (realPath(found.top) !== realPath(path)) {
    return untracked('not-a-repository', `${label} is not a git repository.`);
  }
  return { tracked: true, workTree: found.top, subPath: '' };
}

/** Whether one of the two folders is the other or is inside it. Both are real paths. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}

function labelOf(root: Root): string {
  if (root.kind === 'lore') return 'the Lore';
  return root.kind === 'repository'
    ? `the repository "${root.name}"`
    : `the publish area "${root.name}"`;
}

/**
 * Refuse a root whose folder is the folder of another root, is inside it or
 * holds it. A claim is held per root, so two roots over the same files would
 * let a claim on one write the other. The folders are compared after symbolic
 * links are resolved. The Lore is kept before a repository, a repository
 * before a publish area, and an earlier entry of the manifest before a later
 * one. The Workbench is never a claim target and takes no part.
 */
function refuseOverlaps(roots: readonly Root[]): Root[] {
  const rank = (root: Root): number =>
    root.kind === 'lore' ? 0 : root.kind === 'repository' ? 1 : 2;
  const kept: { root: Root; real: string }[] = [];
  const refused = new Map<string, string>();
  const candidates = roots.filter((root) => root.kind !== 'workbench' && root.path !== '');
  for (const root of [...candidates].sort((a, b) => rank(a) - rank(b))) {
    if (!root.tracking.tracked && root.tracking.reason === 'path-refused') continue;
    const real = realPath(root.path);
    const other = kept.find((entry) => overlaps(real, entry.real));
    if (other === undefined) kept.push({ root, real });
    else refused.set(root.id, labelOf(other.root));
  }
  return roots.map((root) => {
    const other = refused.get(root.id);
    if (other === undefined) return root;
    const label = labelOf(root);
    const message = `${label[0]?.toUpperCase()}${label.slice(1)} shares its folder with ${other}, so it is not used.`;
    return { ...root, tracking: untracked('path-refused', message) };
  });
}

/**
 * Resolve the roots of the Space at `spaceRoot`, in the order the Files window
 * shows them: the Lore, the Workbench, the publish areas in the manifest's
 * order, the repositories in the manifest's order.
 */
export async function resolveRoots(input: ResolveRootsInput): Promise<ResolveRootsResult> {
  let manifest = input.manifest;
  if (manifest === undefined) {
    const read = await readSpaceManifest(input.spaceRoot);
    if (!read.ok) return read;
    manifest = read.value;
  }
  const git = createGitPort(input.runner);
  const paths = spacePaths(input.spaceRoot);
  const roots: Root[] = [];

  roots.push({
    id: LORE_ROOT_ID,
    kind: 'lore',
    name: 'lore',
    path: paths.lore,
    tracking: await trackFolder(input.runner, git, paths.lore, 'The Lore'),
  });
  roots.push({
    id: WORKBENCH_ROOT_ID,
    kind: 'workbench',
    name: 'workbench',
    path: paths.workbench,
    tracking: untracked('git-ignored', 'The Workbench has no change tracking.'),
  });

  for (const area of manifest.publishAreas) {
    const label = `The publish area "${area.name}"`;
    const publishRoot = (path: string, tracking: RootTracking): Root => ({
      id: rootIdOf('publish-area', area.name),
      kind: 'publish-area',
      name: area.name,
      path,
      tracking,
    });
    if (area.path !== null) {
      const joined = safeJoin(paths.root, area.path);
      roots.push(
        joined.ok
          ? publishRoot(joined.value, await trackFolder(input.runner, git, joined.value, label))
          : publishRoot(
              resolve(paths.root, area.path),
              untracked('path-refused', `${label}: ${joined.error.message}.`),
            ),
      );
      continue;
    }
    const outside = input.outsidePublishAreas?.[area.name];
    if (outside === undefined || !isAbsolute(outside)) {
      const message = `${label} is outside the Space and this desk has no folder for it.`;
      roots.push(publishRoot('', untracked('path-unknown', message)));
      continue;
    }
    const path = resolve(outside);
    roots.push(publishRoot(path, await trackFolder(input.runner, git, path, label)));
  }

  for (const repository of manifest.repositories) {
    const label = `The repository "${repository.name}"`;
    const joined = safeJoin(paths.repos, repository.name);
    roots.push({
      id: rootIdOf('repository', repository.name),
      kind: 'repository',
      name: repository.name,
      path: joined.ok ? joined.value : resolve(paths.repos, repository.name),
      tracking: joined.ok
        ? await trackRepository(git, joined.value, label)
        : untracked('path-refused', `${label}: ${joined.error.message}.`),
    });
  }
  return ok(refuseOverlaps(roots));
}
