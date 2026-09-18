/**
 * Detection: what the folder the Human Lead opened is.
 *
 * The focus fixes three cases: a Space of AI-Lore 1.0, an AI-Lore project of
 * v0.8 or older recognised by its manifest and core version, and neither.
 * "Neither" is split in two, because a plain git repository gets the offer to
 * create a Space about it.
 *
 * Detection only reads. It creates no file, its git commands carry
 * `--no-optional-locks`, and a file reached through a symbolic link that
 * leaves the folder is not read. Every verdict carries a `reason`, a sentence
 * that can be shown to the Human Lead.
 *
 * The v0.8 reader of the existing cockpit (`chain/lore.ts`,
 * `workspace/version.ts`) looks for the old manifest at one place only and is
 * left as it is. This module looks at both places.
 */

import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FAILSAFE_SCHEMA, load as loadYaml } from 'js-yaml';
import type { GitPort } from '../exec/git-port.js';
import { isPathInside, safeJoin } from '../fs/paths.js';
import { SPACE_LAYOUT } from '../layout/space-paths.js';
import { type SpaceManifest, readSpaceManifest } from '../manifest/space-manifest.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';

/** The start of the name of the Lore folder of a project of v0.8 or older. */
export const LEGACY_LORE_PREFIX = '.ai-lore-';

/** Where the manifest of a v0.8 project is, and where older versions kept it, relative to the Lore folder. */
export const LEGACY_MANIFEST_LOCATIONS = [
  { location: 'memory-folder', relativePath: 'memory/workspace.yaml' },
  { location: 'lore-folder', relativePath: 'workspace.yaml' },
] as const;

/** Which of the two places the manifest of a legacy project was found at. */
export type LegacyManifestLocation = (typeof LEGACY_MANIFEST_LOCATIONS)[number]['location'];

/**
 * Where the `core_version` of a legacy project stands in relation to v0.8,
 * which is the one version migration accepts. `v0.8`: `0.8` or a `0.8.x`.
 * `older`: below 0.8; the project is upgraded to v0.8 first. `newer`: above
 * 0.8.x (`0.9`, `0.10`, `1.0`), which this companion does not know. `unknown`:
 * no `core_version`, or text that is not numbers joined by dots (`v0.8`).
 */
export type LegacyVersionStanding = 'v0.8' | 'older' | 'newer' | 'unknown';

/** What a folder is. `reason` says why, in a sentence for the Human Lead. */
export type FolderKind =
  | { kind: 'space'; root: string; manifest: SpaceManifest; reason: string }
  | {
      kind: 'legacy';
      root: string;
      /** The `.ai-lore-<name>` folder. */
      lorePath: string;
      projectName: string;
      /** The text of `core_version`, or `null` when the manifest has none. */
      coreVersion: string | null;
      manifestLocation: LegacyManifestLocation;
      /** True when `coreVersion` is `0.8` or a `0.8.x`. */
      migratable: boolean;
      /**
       * Why a project that is not migratable is not: the migration screen shows
       * "upgrade to v0.8 first" for `older`, and says that the version is not
       * known to it for `newer` and `unknown`.
       */
      versionStanding: LegacyVersionStanding;
      reason: string;
    }
  | { kind: 'plain-repository'; root: string; originUrl: string | null; reason: string }
  | {
      kind: 'other';
      root: string;
      /**
       * Which marker was found and could not be used: the Space's manifest, or
       * the Lore folder of a legacy project. `null` when no marker was found.
       */
      broken: 'space-manifest' | 'legacy-project' | null;
      reason: string;
    };

/** Why detection gave no verdict: the path is not a folder, or the folder cannot be listed. */
export type DetectFailureKind = 'not-a-folder' | 'folder-unreadable';

/** What `detectFolder` needs from its caller. */
export type DetectDeps = {
  /** Used to confirm a plain repository and to read its origin address. Read commands only. */
  git: GitPort;
};

/** Whether a `core_version` is one that migration accepts: `0.8` or a `0.8.x`. */
export function isMigratableCoreVersion(coreVersion: string | null): boolean {
  return coreVersion !== null && /^0\.8(\.[0-9]+)*$/.test(coreVersion);
}

/** Where a `core_version` stands in relation to v0.8. The numbers are compared as numbers, so `0.10` is newer. */
export function legacyVersionStanding(coreVersion: string | null): LegacyVersionStanding {
  if (coreVersion === null || !/^[0-9]+(\.[0-9]+)*$/.test(coreVersion)) return 'unknown';
  if (isMigratableCoreVersion(coreVersion)) return 'v0.8';
  const [major = 0, minor = 0] = coreVersion.split('.').map(Number);
  return major === 0 && minor < 8 ? 'older' : 'newer';
}

/** A legacy manifest is a few lines. A larger file is not read. */
const LEGACY_MANIFEST_MAX_BYTES = 1024 * 1024;

type Other = Extract<FolderKind, { kind: 'other' }>;

function other(root: string, broken: Other['broken'], reason: string): Other {
  return { kind: 'other', root, broken, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entry at `path` without following a symbolic link, or `null` when there is none. */
async function entryAt(path: string): Promise<'directory' | 'file' | 'link' | null> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return 'link';
    return info.isDirectory() ? 'directory' : 'file';
  } catch {
    return null;
  }
}

/** Whether `path`, after symbolic links are resolved, is a folder inside `root`. */
async function isFolderInside(root: string, path: string): Promise<boolean | 'outside'> {
  const inside = isPathInside(root, path);
  if (!inside.ok || !inside.value) return 'outside';
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() === true;
}

function legacyReason(
  projectName: string,
  coreVersion: string | null,
  relativePath: string,
): string {
  const found = `This is the AI-Lore project ${projectName}: ${relativePath} names it`;
  if (coreVersion === null) {
    return `${found} and has no core_version. Migration needs core_version 0.8, so the project is upgraded to v0.8 first.`;
  }
  switch (legacyVersionStanding(coreVersion)) {
    case 'v0.8':
      return `${found} with core_version ${coreVersion}. It can be migrated to a Space of AI-Lore 1.0.`;
    case 'older':
      return `${found} with core_version ${coreVersion}. Migration accepts core_version 0.8 only, so the project is upgraded to v0.8 first.`;
    case 'newer':
      return `${found} with core_version ${coreVersion}. Migration accepts core_version 0.8 only, and ${coreVersion} is newer than any version this companion knows, so the project cannot be migrated by it.`;
    case 'unknown':
      return `${found} with core_version ${coreVersion}, which is not a version number. Migration accepts core_version 0.8 only, written as "0.8".`;
  }
}

/** The text of the legacy manifest at `path`: `null` when there is none, a sentence when it cannot be read. */
async function readLegacyManifestText(
  path: string,
): Promise<{ text: string } | { unreadable: string } | null> {
  try {
    // The size is asked first: a path that is not a regular file is never opened, and a
    // file that is too large to be a manifest is not taken into memory.
    const info = await stat(path);
    if (!info.isFile()) return { unreadable: 'it is not a file' };
    if (info.size > LEGACY_MANIFEST_MAX_BYTES) {
      return { unreadable: `it has ${info.size} bytes, which is too large for a manifest` };
    }
    return { text: await readFile(path, 'utf8') };
  } catch (caught) {
    const code = errorCode(caught);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    return { unreadable: errorMessage(caught) };
  }
}

/** Read the manifest of the legacy project whose Lore folder is `loreName` under `root`. */
async function readLegacyProject(root: string, loreName: string): Promise<FolderKind> {
  const broken = (reason: string): Other => other(root, 'legacy-project', reason);
  const expectedName = loreName.slice(LEGACY_LORE_PREFIX.length);
  for (const { location, relativePath } of LEGACY_MANIFEST_LOCATIONS) {
    const shown = `${loreName}/${relativePath}`;
    const path = safeJoin(root, shown);
    if (!path.ok) {
      return broken(
        `${shown} is reached through a symbolic link that leaves the folder, and is not read.`,
      );
    }
    const read = await readLegacyManifestText(path.value);
    if (read === null) continue;
    if ('unreadable' in read) return broken(`${shown} cannot be read: ${read.unreadable}.`);
    let data: unknown;
    try {
      // The failsafe schema keeps every scalar as text, so `core_version: 0.10` stays `0.10`.
      data = loadYaml(read.text, { schema: FAILSAFE_SCHEMA });
    } catch (caught) {
      return broken(`${shown} is not valid YAML: ${errorMessage(caught)}.`);
    }
    if (!isRecord(data)) return broken(`${shown} is not a map of keys and values.`);
    const projectName = data.project_name;
    if (typeof projectName !== 'string' || projectName === '') {
      return broken(`${shown} has no project_name.`);
    }
    if (projectName !== expectedName) {
      return broken(
        `${shown} has project_name ${projectName}, and the folder is named for ${expectedName}.`,
      );
    }
    const version = data.core_version;
    const coreVersion = typeof version === 'string' && version !== '' ? version : null;
    return {
      kind: 'legacy',
      root,
      lorePath: join(root, loreName),
      projectName,
      coreVersion,
      manifestLocation: location,
      migratable: isMigratableCoreVersion(coreVersion),
      versionStanding: legacyVersionStanding(coreVersion),
      reason: legacyReason(projectName, coreVersion, shown),
    };
  }
  return broken(
    `${loreName} has no workspace.yaml, at memory/workspace.yaml or at its top, so its version is not known.`,
  );
}

/** The legacy verdict of `root`, or `null` when it has no `.ai-lore-<name>` folder. */
async function detectLegacy(root: string, names: readonly string[]): Promise<FolderKind | null> {
  const folders: string[] = [];
  for (const name of names) {
    if (!name.startsWith(LEGACY_LORE_PREFIX) || name === LEGACY_LORE_PREFIX) continue;
    const path = join(root, name);
    const entry = await entryAt(path);
    if (entry === 'directory') folders.push(name);
    if (entry !== 'link') continue;
    const linked = await isFolderInside(root, path);
    if (linked === 'outside') {
      return other(
        root,
        'legacy-project',
        `${name} is a symbolic link that leaves the folder, and is not followed.`,
      );
    }
    if (linked) folders.push(name);
  }
  const [only, ...rest] = folders;
  if (only === undefined) return null;
  if (rest.length > 0) {
    return other(
      root,
      'legacy-project',
      `The folder has more than one ${LEGACY_LORE_PREFIX}<name> folder (${folders.join(', ')}), so it is not known which is the project's.`,
    );
  }
  return readLegacyProject(root, only);
}

/**
 * The verdict for a folder that is the Lore folder of a legacy project, or the
 * `memory/` folder inside it, opened in place of the project's folder; `null`
 * for any other folder. `memory/` is a git repository of its own, so without
 * this it would be offered as a plain repository to create a Space about.
 * Only the folder's own path and its own files are looked at.
 */
async function detectInsideLegacy(root: string): Promise<FolderKind | null> {
  const isLoreName = (name: string): boolean =>
    name.startsWith(LEGACY_LORE_PREFIX) && name !== LEGACY_LORE_PREFIX;
  const parent = dirname(root);
  let projectRoot: string;
  let manifests: string[];
  if (isLoreName(basename(root))) {
    projectRoot = parent;
    manifests = LEGACY_MANIFEST_LOCATIONS.map(({ relativePath }) => relativePath);
  } else if (basename(root) === 'memory' && isLoreName(basename(parent))) {
    projectRoot = dirname(parent);
    manifests = ['workspace.yaml'];
  } else {
    return null;
  }
  for (const relativePath of manifests) {
    if ((await entryAt(join(root, relativePath))) !== 'file') continue;
    return other(
      root,
      'legacy-project',
      `This folder is inside an AI-Lore project of v0.8 or older: it is ${
        projectRoot === parent ? 'its Lore folder' : 'the memory folder of its Lore folder'
      }. The project's folder is ${projectRoot}; open that folder instead.`,
    );
  }
  return null;
}

/** The plain-repository verdict of `root`, or `null` when it has no `.git` entry of its own. */
async function detectRepository(root: string, git: GitPort): Promise<FolderKind | null> {
  const dotGit = join(root, '.git');
  const entry = await entryAt(dotGit);
  if (entry === null) return null;
  if (entry === 'link') {
    const inside = isPathInside(root, dotGit);
    if (!inside.ok || !inside.value) {
      return other(
        root,
        null,
        '.git is a symbolic link that leaves the folder, and is not followed.',
      );
    }
  }
  const repository = await git.isRepository(root);
  if (repository.ok && !repository.value) {
    return other(root, null, 'The folder has a .git entry that git does not read as a repository.');
  }
  const origin = repository.ok ? await git.originUrl(root) : repository;
  if (!origin.ok) {
    return {
      kind: 'plain-repository',
      root,
      originUrl: null,
      reason: `The folder is a git repository with no Lore. Its origin address was not read: ${origin.error.message}`,
    };
  }
  return {
    kind: 'plain-repository',
    root,
    originUrl: origin.value,
    reason:
      origin.value === null
        ? 'The folder is a git repository with no Lore and no remote named origin.'
        : `The folder is a git repository with no Lore. Its origin is ${origin.value}.`,
  };
}

/**
 * Say what the folder `root` is. The order is: a Space (`lore/space.md` with
 * `type: space`), then a legacy project (one `.ai-lore-<name>` folder whose
 * manifest names it), then the Lore folder of a legacy project opened in place
 * of the project (`other`, with the project's folder in the reason), then a
 * plain git repository, then anything else. A folder with both markers is a
 * Space, and the reason names the legacy Lore folder that is also there. A
 * marker that is there and cannot be used (a manifest outside the frontmatter
 * subset, a Lore folder with no manifest) gives `other` with `broken` set, and
 * the later cases are not tried: the folder is not offered as a plain
 * repository when it is a damaged Space. The one exception: a `lore/space.md`
 * that was not read as far as `type: space` does not hide a legacy project
 * that is recognised in full.
 *
 * Detection never writes and never throws: what cannot be read becomes a
 * verdict with a reason, or a failure.
 */
export async function detectFolder(
  root: string,
  deps: DetectDeps,
): Promise<Result<FolderKind, Failure<DetectFailureKind>>> {
  try {
    return await detect(root, deps);
  } catch (caught) {
    // Nothing above is expected to throw. A `GitPort` that rejects, or an error of the
    // file system that no branch foresaw, still gives a failure and not an exception.
    return fail('folder-unreadable', `cannot say what ${root} is: ${errorMessage(caught)}`);
  }
}

async function detect(
  root: string,
  deps: DetectDeps,
): Promise<Result<FolderKind, Failure<DetectFailureKind>>> {
  const folder = resolve(root);
  const info = await stat(folder).catch(() => null);
  if (info === null || !info.isDirectory()) {
    return fail('not-a-folder', `${folder} is not a folder`);
  }
  let names: string[];
  try {
    names = (await readdir(folder)).sort();
  } catch (caught) {
    return fail('folder-unreadable', `cannot list ${folder}: ${errorMessage(caught)}`);
  }

  const manifest = await readSpaceManifest(folder);
  if (manifest.ok) {
    const named =
      manifest.value.name === ''
        ? 'a Space that setup has not named yet'
        : `the Space ${manifest.value.name}`;
    const alsoLegacy = names.filter(
      (name) => name.startsWith(LEGACY_LORE_PREFIX) && name !== LEGACY_LORE_PREFIX,
    );
    const also =
      alsoLegacy.length === 0
        ? ''
        : ` The folder also has ${alsoLegacy.join(', ')}, the Lore folder of an AI-Lore project of v0.8 or older; it is opened as a Space and that folder is left as it is.`;
    return ok({
      kind: 'space',
      root: folder,
      manifest: manifest.value,
      reason: `This is ${named}: ${SPACE_LAYOUT.manifest} has type: space, format ${manifest.value.format}.${also}`,
    });
  }
  const skipped = manifest.error.kind;
  const markerAbsent = skipped === 'manifest-missing' || skipped === 'not-a-space-manifest';
  // A file that was read as far as `type: space` says that the folder is a Space. A file that
  // was not read that far (no frontmatter, frontmatter of another tool) says nothing, so a
  // legacy project that happens to hold a `lore/space.md` is still a legacy project.
  const claimsSpace = skipped === 'unsupported-format' || skipped === 'invalid-manifest';
  const brokenSpace = other(
    folder,
    'space-manifest',
    `${SPACE_LAYOUT.manifest} is there and cannot be used: ${manifest.error.message}.`,
  );
  if (claimsSpace) return ok(brokenSpace);

  const legacy = await detectLegacy(folder, names);
  if (legacy !== null && (legacy.kind === 'legacy' || markerAbsent)) return ok(legacy);
  if (!markerAbsent) return ok(brokenSpace);

  const insideLegacy = await detectInsideLegacy(folder);
  if (insideLegacy !== null) return ok(insideLegacy);

  const repository = await detectRepository(folder, deps.git);
  if (repository !== null) return ok(repository);

  return ok(
    other(
      folder,
      null,
      skipped === 'not-a-space-manifest'
        ? `${SPACE_LAYOUT.manifest} is there without type: space, and the folder has no ${LEGACY_LORE_PREFIX}<name> folder and no git repository of its own.`
        : `The folder has no ${SPACE_LAYOUT.manifest}, no ${LEGACY_LORE_PREFIX}<name> folder and no git repository of its own.`,
    ),
  );
}
