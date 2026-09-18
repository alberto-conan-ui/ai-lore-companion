/**
 * The scaffold: the folder of a new Space, made from the Lore template.
 *
 * `scaffoldSpace` writes `lore/space.md` first, with the Space's name and its
 * repository, and copies the rest of the template after it. A folder left by a
 * run that was killed therefore always holds a manifest that names this Space,
 * which is what `inspectSetupTarget` recognises. A file that is already at the
 * destination is kept as it is, so the scaffold can run again.
 */

import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isAtomicTempName, writeFileAtomic } from '../fs/atomic-write.js';
import { copyTree } from '../fs/copy-tree.js';
import { SPACE_LAYOUT, type SpacePaths, spacePaths } from '../layout/space-paths.js';
import {
  type SpaceManifest,
  type SpaceManifestRepository,
  readSpaceManifest,
  writeSpaceManifest,
} from '../manifest/space-manifest.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import type { SetupTargetState } from './types.js';

/** The template's file that becomes `.gitignore`. */
export const GITIGNORE_TEMPLATE = 'gitignore.template';

/** What the scaffold writes into `lore/space.md`. */
export type ScaffoldManifestValues = {
  /** The Space's name. */
  name: string;
  /** The Space repository, as `owner/name`. */
  repository: string;
  /** The Project's number under the owner. */
  project: number;
  repositories: SpaceManifestRepository[];
};

/** What `scaffoldSpace` needs. */
export type ScaffoldInput = {
  /** The Lore template. It is only read. */
  templateDir: string;
  /** The Space's folder. It is created when missing. */
  spaceRoot: string;
  manifest: ScaffoldManifestValues;
};

/**
 * Why a scaffold failed.
 * `template-invalid`: the template folder lacks `lore/space.md` or `gitignore.template`.
 * `scaffold-failed`: a folder or a file could not be written.
 */
export type ScaffoldFailureKind = 'template-invalid' | 'scaffold-failed';

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() === true;
}

/** The folders every desk has and the Space repository ignores. */
function deskFolders(paths: SpacePaths): string[] {
  return [paths.repos, paths.drafts, paths.journal, paths.scratch];
}

/** Whether `repos/` and the three Workbench folders exist. */
export async function hasDeskFolders(spaceRoot: string): Promise<boolean> {
  for (const dir of deskFolders(spacePaths(spaceRoot))) {
    if (!(await isDirectory(dir))) return false;
  }
  return true;
}

/** Create `repos/` and the three Workbench folders. Folders that exist are left as they are. */
export async function ensureDeskFolders(
  spaceRoot: string,
): Promise<Result<void, Failure<'scaffold-failed'>>> {
  try {
    for (const dir of deskFolders(spacePaths(spaceRoot))) await mkdir(dir, { recursive: true });
    return ok(undefined);
  } catch (caught) {
    return fail(
      'scaffold-failed',
      `The Workbench and repos/ could not be created in ${spaceRoot}: ${errorMessage(caught)}`,
    );
  }
}

/** The files of the template, relative with `/`, without `gitignore.template`. */
export async function listTemplateFiles(templateDir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(templateDir, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (child !== GITIGNORE_TEMPLATE) files.push(child);
    }
  };
  await walk('');
  return files.sort();
}

function sameRepositories(
  a: readonly SpaceManifestRepository[],
  b: readonly SpaceManifestRepository[],
): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.name === b[index]?.name && entry.github === b[index]?.github)
  );
}

function manifestHolds(manifest: SpaceManifest, values: ScaffoldManifestValues): boolean {
  return (
    manifest.name === values.name &&
    manifest.github.repository === values.repository &&
    manifest.github.project === values.project &&
    sameRepositories(manifest.repositories, values.repositories)
  );
}

/**
 * Whether the scaffold is complete: the manifest holds the values, every file
 * of the template is there, `.gitignore` is there, and the desk's folders
 * exist. Nothing is written.
 */
export async function isScaffolded(input: ScaffoldInput): Promise<boolean> {
  const manifest = await readSpaceManifest(input.spaceRoot);
  if (!manifest.ok || !manifestHolds(manifest.value, input.manifest)) return false;
  if (!(await exists(join(input.spaceRoot, '.gitignore')))) return false;
  if (!(await hasDeskFolders(input.spaceRoot))) return false;
  try {
    for (const file of await listTemplateFiles(input.templateDir)) {
      if (!(await exists(join(input.spaceRoot, ...file.split('/'))))) return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Make the Space's folder from the template: `lore/space.md` with the values
 * first, then the rest of the template, `.gitignore` from `gitignore.template`,
 * `repos/` and the Workbench folders. A file that is already there is kept.
 * Returns the number of files copied by this call.
 */
export async function scaffoldSpace(
  input: ScaffoldInput,
): Promise<Result<{ copied: number }, Failure<ScaffoldFailureKind>>> {
  const { templateDir, spaceRoot, manifest: values } = input;
  let manifestTemplate: string;
  let ignoreTemplate: string;
  try {
    manifestTemplate = await readFile(
      join(templateDir, ...SPACE_LAYOUT.manifest.split('/')),
      'utf8',
    );
    ignoreTemplate = await readFile(join(templateDir, GITIGNORE_TEMPLATE), 'utf8');
  } catch (caught) {
    return fail(
      'template-invalid',
      `The Lore template at ${templateDir} cannot be used: ${errorMessage(caught)}`,
    );
  }

  const manifestPath = spacePaths(spaceRoot).manifest;
  if (!(await exists(manifestPath))) {
    const placed = await writeFileAtomic(manifestPath, manifestTemplate);
    if (!placed.ok) return fail('scaffold-failed', placed.error.message);
  }
  const current = await readSpaceManifest(spaceRoot);
  if (!current.ok) return fail('scaffold-failed', current.error.message);
  if (!manifestHolds(current.value, values)) {
    const written = await writeSpaceManifest(spaceRoot, {
      ...current.value,
      name: values.name,
      github: { ...current.value.github, repository: values.repository, project: values.project },
      repositories: values.repositories,
    });
    if (!written.ok) return fail('scaffold-failed', written.error.message);
  }

  const copied = await copyTree(templateDir, spaceRoot, {
    exclude: [GITIGNORE_TEMPLATE],
    onConflict: 'keep',
  });
  if (!copied.ok) return fail('scaffold-failed', copied.error.message);

  const ignorePath = join(spaceRoot, '.gitignore');
  if (!(await exists(ignorePath))) {
    const ignored = await writeFileAtomic(ignorePath, ignoreTemplate);
    if (!ignored.ok) return fail('scaffold-failed', ignored.error.message);
  }
  const folders = await ensureDeskFolders(spaceRoot);
  if (!folders.ok) return folders;
  return ok({ copied: copied.value.filter((file) => file.status === 'copied').length });
}

/** Whether a folder holds nothing a Space could lose: nothing, or what a killed scaffold's first write left. */
async function holdsNothing(root: string): Promise<boolean> {
  const ignorable = (name: string): boolean => name === '.DS_Store' || isAtomicTempName(name);
  const entries = (await readdir(root)).filter((name) => !ignorable(name));
  if (entries.length === 0) return true;
  if (entries.length !== 1 || entries[0] !== SPACE_LAYOUT.lore) return false;
  const lore = join(root, SPACE_LAYOUT.lore);
  if (!(await isDirectory(lore))) return false;
  return (await readdir(lore)).every(ignorable);
}

/**
 * Say what the folder a Space is to be made in holds. A folder that is not
 * empty is accepted only when it is this same Space, half-made or whole: its
 * `lore/space.md` reads as a manifest whose `name` is `expected.name` (when
 * given) and whose `github.repository` is `expected.repository`, compared
 * without regard to case. Anything else is refused, and nothing is changed.
 */
export async function inspectSetupTarget(
  spaceRoot: string,
  expected: { name?: string; repository: string },
): Promise<Result<SetupTargetState, Failure<'target-not-empty'>>> {
  try {
    const info = await lstat(spaceRoot).catch((caught: unknown) => {
      if (errorCode(caught) === 'ENOENT') return null;
      throw caught;
    });
    if (info === null) return ok('absent');
    if (!info.isDirectory()) {
      return fail(
        'target-not-empty',
        `${spaceRoot} is a file or a link, not a folder, so the Space cannot be made there.`,
      );
    }
    if (await holdsNothing(spaceRoot)) return ok('empty');
  } catch (caught) {
    return fail('target-not-empty', `${spaceRoot} cannot be read: ${errorMessage(caught)}`);
  }

  const manifest = await readSpaceManifest(spaceRoot);
  if (!manifest.ok) {
    return fail(
      'target-not-empty',
      `${spaceRoot} is not empty and holds no Space manifest at ${SPACE_LAYOUT.manifest}, so nothing is written there. Choose an empty folder or another name.`,
    );
  }
  const sameName = expected.name === undefined || manifest.value.name === expected.name;
  const sameRepository =
    manifest.value.github.repository.toLowerCase() === expected.repository.toLowerCase();
  if (!sameName || !sameRepository) {
    return fail(
      'target-not-empty',
      `${spaceRoot} holds another Space: its manifest names "${manifest.value.name}" with the repository "${manifest.value.github.repository}", not ${expected.repository}. Nothing is written there.`,
    );
  }
  return ok('half-made');
}
