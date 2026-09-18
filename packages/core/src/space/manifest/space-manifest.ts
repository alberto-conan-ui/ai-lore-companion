/**
 * The Space's manifest card, `lore/space.md`.
 *
 * The manifest names the Space, its place on GitHub and its payloads, and
 * holds no state. Its frontmatter with `type: space` is also what marks a
 * folder as a Space of AI-Lore 1.0. `detect/`, `roots/`, `setup/` and
 * `migrate/` reach the file only through `readSpaceManifest` and
 * `writeSpaceManifest`.
 *
 * The frontmatter is read in the subset of the corpus entry "frontmatter", and
 * text outside the subset is reported, not read. Keys this version does not
 * know are kept in `extra` and written back. Comment lines of the frontmatter
 * are not kept by a write; the prose below the frontmatter is.
 */

import { readFile, stat } from 'node:fs/promises';
import {
  type FrontmatterMap,
  type FrontmatterValue,
  type LoreFrontmatter,
  parseLoreFrontmatter,
  serializeLoreFrontmatter,
  splitFrontmatter,
} from '../frontmatter/index.js';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { safeJoin } from '../fs/paths.js';
import { SPACE_LAYOUT } from '../layout/space-paths.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';

/** The value of `format` this version reads and writes. */
export const SPACE_MANIFEST_FORMAT = 1;

/** The value of `type` that marks `lore/space.md` as a Space's manifest. */
export const SPACE_MANIFEST_TYPE = 'space';

/** Keys of a map of the manifest that this version does not know. They are written back as they were read. */
export type SpaceManifestExtra = Record<string, string | number | boolean | null>;

/** Where the Space is on GitHub. */
export type SpaceManifestGitHub = {
  /** The Space repository as `owner/name`. Empty in the template, before setup has run. */
  repository: string;
  /** The number of the Space's GitHub Project under that owner. `0` before setup has run. */
  project: number;
  extra?: SpaceManifestExtra;
};

/** One repository of the Space. Its checkout is always the folder `repos/<name>`. */
export type SpaceManifestRepository = {
  name: string;
  /** The repository on GitHub, as `owner/name`. */
  github: string;
  extra?: SpaceManifestExtra;
};

/** One publish area of the Space. */
export type SpaceManifestPublishArea = {
  name: string;
  /**
   * The folder, relative to the Space's folder, with `/`. `null` for a publish
   * area outside the Space's folder, whose path is kept with the desk's records.
   */
  path: string | null;
  extra?: SpaceManifestExtra;
};

/** The manifest of a Space, as plain data. */
export type SpaceManifest = {
  format: typeof SPACE_MANIFEST_FORMAT;
  /** The name of the Space. Empty in the template, before setup has run. */
  name: string;
  github: SpaceManifestGitHub;
  repositories: SpaceManifestRepository[];
  publishAreas: SpaceManifestPublishArea[];
  /** Top-level keys this version does not know, written back as they were read. */
  extra?: LoreFrontmatter;
};

/**
 * Why a manifest was not read or not written.
 * `manifest-missing`: there is no `lore/space.md`.
 * `manifest-outside-space`: the file is reached through a symbolic link that leaves the folder.
 * `manifest-unreadable`: the file is there and could not be read, or is larger than a manifest can be.
 * `no-frontmatter`, `outside-subset`, `readers-differ`: the frontmatter is missing, is not in
 * the subset, or is read to other values by a full YAML reader.
 * `not-a-space-manifest`: the frontmatter has no `type: space`.
 * `unsupported-format`: `format` is a number this version does not read.
 * `invalid-manifest`: a key is missing or has a value of the wrong form.
 * `write-failed`: the file could not be written.
 */
export type ManifestFailureKind =
  | 'manifest-missing'
  | 'manifest-outside-space'
  | 'manifest-unreadable'
  | 'no-frontmatter'
  | 'outside-subset'
  | 'readers-differ'
  | 'not-a-space-manifest'
  | 'unsupported-format'
  | 'invalid-manifest'
  | 'write-failed';

/** The result of a manifest function. */
export type ManifestResult<T> = Result<T, Failure<ManifestFailureKind>>;

/** A manifest is a few dozen lines. A larger file is not read. */
const MANIFEST_MAX_BYTES = 1024 * 1024;
const TOP_LEVEL_KEYS = ['type', 'format', 'name', 'github', 'repositories', 'publish_areas'];
/** A payload's name is a folder name (`repos/<name>`) and a file name (`lore/mirrors/<name>.md`). */
const PAYLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const DEFAULT_BODY = [
  '',
  "# The Space's manifest",
  '',
  'This file names the Space, its place on GitHub and its payloads. It holds no state.',
  '',
].join('\n');

/** Thrown inside this file only; turned into an `invalid-manifest` failure. */
class InvalidManifest extends Error {}

function invalid(message: string): never {
  throw new InvalidManifest(message);
}

function isMap(value: FrontmatterValue | undefined): value is FrontmatterMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isListOfMaps(value: FrontmatterValue | undefined): value is FrontmatterMap[] {
  return Array.isArray(value) && value.every((item) => isMap(item));
}

function textOf(map: FrontmatterMap, key: string, where: string): string {
  const value = map[key];
  if (typeof value !== 'string') invalid(`${where}.${key} must be text`);
  return value;
}

/** The keys of `map` other than `known`, or `undefined` when there is none. */
function extraOf(map: FrontmatterMap, known: readonly string[]): SpaceManifestExtra | undefined {
  const extra: SpaceManifestExtra = {};
  for (const [key, value] of Object.entries(map)) {
    if (!known.includes(key)) extra[key] = value;
  }
  return Object.keys(extra).length === 0 ? undefined : extra;
}

function withExtra<T extends object>(value: T, extra: SpaceManifestExtra | undefined): T {
  return extra === undefined ? value : { ...value, extra };
}

function checkPayloadName(name: string, where: string, seen: Set<string>): void {
  if (!PAYLOAD_NAME.test(name) || name.endsWith('.')) {
    invalid(
      `${where}.name must begin with a letter or a digit and have only letters, digits, ".", "_" and "-": ${name}`,
    );
  }
  const folded = name.toLowerCase();
  if (seen.has(folded)) invalid(`${where}.name is used by another payload: ${name}`);
  seen.add(folded);
}

function checkPublishPath(path: string, where: string): void {
  const segments = path.split('/');
  const bad =
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (bad) {
    invalid(
      `${where}.path must be a folder inside the Space, written relative to it with "/": ${path}`,
    );
  }
}

function githubOf(data: LoreFrontmatter): SpaceManifestGitHub {
  const value = data.github;
  if (!isMap(value)) invalid('github must be a map with the keys repository and project');
  const repository = textOf(value, 'repository', 'github');
  if (repository !== '' && !GITHUB_REPOSITORY.test(repository)) {
    invalid(`github.repository must be written as owner/name: ${repository}`);
  }
  const project = value.project;
  if (typeof project !== 'number') invalid('github.project must be a whole number');
  return withExtra({ repository, project }, extraOf(value, ['repository', 'project']));
}

function repositoriesOf(data: LoreFrontmatter, seen: Set<string>): SpaceManifestRepository[] {
  const value = data.repositories;
  if (!isListOfMaps(value)) invalid('repositories must be a list of maps, or []');
  return value.map((item, index) => {
    const where = `repositories[${index}]`;
    const name = textOf(item, 'name', where);
    checkPayloadName(name, where, seen);
    const github = textOf(item, 'github', where);
    if (!GITHUB_REPOSITORY.test(github)) {
      invalid(`${where}.github must be written as owner/name: ${github}`);
    }
    return withExtra({ name, github }, extraOf(item, ['name', 'github']));
  });
}

function publishAreasOf(data: LoreFrontmatter, seen: Set<string>): SpaceManifestPublishArea[] {
  const value = data.publish_areas;
  if (!isListOfMaps(value)) invalid('publish_areas must be a list of maps, or []');
  return value.map((item, index) => {
    const where = `publish_areas[${index}]`;
    const name = textOf(item, 'name', where);
    checkPayloadName(name, where, seen);
    let path: string | null = null;
    if (Object.hasOwn(item, 'path')) {
      path = textOf(item, 'path', where);
      checkPublishPath(path, where);
    }
    return withExtra({ name, path }, extraOf(item, ['name', 'path']));
  });
}

function manifestFromFrontmatter(data: LoreFrontmatter): ManifestResult<SpaceManifest> {
  if (data.type !== SPACE_MANIFEST_TYPE) {
    return fail(
      'not-a-space-manifest',
      `the frontmatter has no "type: ${SPACE_MANIFEST_TYPE}" (type is ${JSON.stringify(data.type ?? null)})`,
    );
  }
  if (typeof data.format !== 'number') {
    return fail('invalid-manifest', 'format must be a whole number');
  }
  if (data.format !== SPACE_MANIFEST_FORMAT) {
    return fail(
      'unsupported-format',
      `format is ${data.format}; this version of the companion reads format ${SPACE_MANIFEST_FORMAT}`,
    );
  }
  try {
    if (typeof data.name !== 'string') invalid('name must be text');
    // A payload's name is also the name of its mirror, so one set of names covers both lists.
    const seen = new Set<string>();
    const manifest: SpaceManifest = {
      format: SPACE_MANIFEST_FORMAT,
      name: data.name,
      github: githubOf(data),
      repositories: repositoriesOf(data, seen),
      publishAreas: publishAreasOf(data, seen),
    };
    const extra: LoreFrontmatter = {};
    for (const [key, value] of Object.entries(data)) {
      if (!TOP_LEVEL_KEYS.includes(key)) extra[key] = value;
    }
    if (Object.keys(extra).length > 0) manifest.extra = extra;
    return ok(manifest);
  } catch (caught) {
    if (caught instanceof InvalidManifest) return fail('invalid-manifest', caught.message);
    throw caught;
  }
}

/** Read a manifest from the text of `lore/space.md`. Nothing is read from disk. */
export function parseSpaceManifest(text: string): ManifestResult<SpaceManifest> {
  const parsed = parseLoreFrontmatter(text);
  if (!parsed.ok) return parsed;
  return manifestFromFrontmatter(parsed.value.data);
}

function frontmatterOf(manifest: SpaceManifest): LoreFrontmatter {
  const data: LoreFrontmatter = {
    type: SPACE_MANIFEST_TYPE,
    format: manifest.format,
    name: manifest.name,
    github: {
      repository: manifest.github.repository,
      project: manifest.github.project,
      ...manifest.github.extra,
    },
    repositories: manifest.repositories.map((repository) => ({
      name: repository.name,
      github: repository.github,
      ...repository.extra,
    })),
    publish_areas: manifest.publishAreas.map((area) => ({
      name: area.name,
      ...(area.path === null ? {} : { path: area.path }),
      ...area.extra,
    })),
  };
  for (const [key, value] of Object.entries(manifest.extra ?? {})) {
    if (!TOP_LEVEL_KEYS.includes(key)) data[key] = value;
  }
  return data;
}

/**
 * The text of `lore/space.md` for `manifest`, with `body` as the prose below
 * the frontmatter (default: two lines that say what the file is). The manifest
 * is checked by the same rules as a read, so that what is written can be read.
 */
export function serializeSpaceManifest(
  manifest: SpaceManifest,
  body: string = DEFAULT_BODY,
): ManifestResult<string> {
  const frontmatter = serializeLoreFrontmatter(frontmatterOf(manifest));
  if (!frontmatter.ok) return fail('invalid-manifest', frontmatter.error.message);
  const text = `---\n${frontmatter.value}\n---\n${body}`;
  const readBack = parseSpaceManifest(text);
  if (!readBack.ok) return fail('invalid-manifest', readBack.error.message);
  return ok(text);
}

/** The path of the manifest of the Space at `root`, refused when a symbolic link takes it outside. */
function manifestPath(root: string): ManifestResult<string> {
  const joined = safeJoin(root, SPACE_LAYOUT.manifest);
  if (joined.ok) return joined;
  return fail(
    'manifest-outside-space',
    `${SPACE_LAYOUT.manifest} is not read or written: ${joined.error.message}`,
  );
}

async function readManifestText(path: string): Promise<ManifestResult<string>> {
  try {
    // The size is asked first, so that a file that is not a manifest is not taken into memory,
    // and a path that is not a regular file (a folder, a pipe) is never opened.
    const info = await stat(path);
    if (!info.isFile()) {
      return fail('manifest-unreadable', `${SPACE_LAYOUT.manifest} is not a file`);
    }
    if (info.size > MANIFEST_MAX_BYTES) {
      return fail(
        'manifest-unreadable',
        `${SPACE_LAYOUT.manifest} has ${info.size} bytes, and a manifest has at most ${MANIFEST_MAX_BYTES}`,
      );
    }
    return ok(await readFile(path, 'utf8'));
  } catch (caught) {
    const code = errorCode(caught);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return fail('manifest-missing', `there is no ${SPACE_LAYOUT.manifest}`);
    }
    return fail(
      'manifest-unreadable',
      `cannot read ${SPACE_LAYOUT.manifest}: ${errorMessage(caught)}`,
    );
  }
}

/** Read the manifest of the Space whose folder is `root`. Nothing is written. */
export async function readSpaceManifest(root: string): Promise<ManifestResult<SpaceManifest>> {
  const path = manifestPath(root);
  if (!path.ok) return path;
  const text = await readManifestText(path.value);
  if (!text.ok) return text;
  return parseSpaceManifest(text.value);
}

/**
 * Write the manifest of the Space whose folder is `root`, atomically. The
 * prose below the frontmatter of the file that is there is kept; a new file
 * gets a short one. A manifest that could not be read back is not written.
 */
export async function writeSpaceManifest(
  root: string,
  manifest: SpaceManifest,
): Promise<ManifestResult<void>> {
  const path = manifestPath(root);
  if (!path.ok) return path;
  const existing = await readManifestText(path.value);
  if (!existing.ok && existing.error.kind !== 'manifest-missing') return existing;
  const split = existing.ok ? splitFrontmatter(existing.value) : null;
  const body = split?.ok === true ? split.value.body : undefined;
  const text = serializeSpaceManifest(manifest, body);
  if (!text.ok) return text;
  const written = await writeFileAtomic(path.value, text.value);
  if (!written.ok) return fail('write-failed', written.error.message);
  return ok(undefined);
}
