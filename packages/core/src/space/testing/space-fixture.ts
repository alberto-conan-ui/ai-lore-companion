/**
 * The fixture "a Space of AI-Lore 1.0": the real Lore template scaffolded into
 * a temporary folder, as a git repository with a bare remote, and optionally
 * with repositories under `repos/` that carry a scripted history.
 *
 * The template folder is a parameter, because the app's tests and core's tests
 * find `packages/spec/lore-1.0` in different ways. Everything the builder
 * creates is under one temporary folder, which `cleanup` removes.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileRunner } from '../exec/exec-file-runner.js';
import { createGitPort } from '../exec/git-port.js';
import { copyTree } from '../fs/copy-tree.js';
import { type SpacePaths, spacePaths } from '../layout/space-paths.js';
import {
  type SpaceManifest,
  readSpaceManifest,
  writeSpaceManifest,
} from '../manifest/space-manifest.js';
import type { Result } from '../result.js';
import { type TempGitRepo, cloneTempRepo, makeTempGitRepo } from './git-repo.js';
import { makeTempDir } from './temp.js';

/** One change of a scripted history. `from` is the old path of a renamed file. */
export type FixtureChange = {
  status: 'added' | 'changed' | 'deleted' | 'renamed';
  /** Relative to the repository, with `/`. */
  path: string;
  from?: string;
};

/** A repository of the Space fixture: a clone of a bare repository, under `repos/<name>`. */
export type SpaceFixtureRepository = {
  name: string;
  /** The `github` value written in the manifest. Nothing on GitHub has this name. */
  github: string;
  /** The checkout at `repos/<name>`. */
  checkout: TempGitRepo;
  /** The bare repository the checkout was cloned from, its `origin`. */
  remote: TempGitRepo;
  /** The first commit, which is also on the remote. A test uses it as the reviewed mark. */
  baseCommit: string;
  /** The second commit, which is only in the checkout. */
  headCommit: string;
  /** What the second commit changed against the first. */
  committedSinceBase: FixtureChange[];
  /** What the working tree changed against the second commit, not committed. */
  uncommitted: FixtureChange[];
};

/** Options of `makeSpaceFixture`. */
export type SpaceFixtureOptions = {
  /** `packages/spec/lore-1.0`, the template the Space is scaffolded from. It is only read. */
  templateDir: string;
  /** The Space's name, also the name of its folder. Default `fixture-space`. */
  name?: string;
  /** The owner part of every `github` value in the manifest. Default `fixture-owner`. */
  owner?: string;
  /** The Project's number in the manifest. Default `7`. */
  project?: number;
  /** Names of repositories to add under `repos/`, each with the scripted history. Default: none. */
  repositories?: readonly string[];
  /**
   * Names of publish areas outside the Space's folder. Each gets a folder
   * beside the Space and an entry with no `path` in the manifest. Default: none.
   */
  outsidePublishAreas?: readonly string[];
};

/** What `makeSpaceFixture` returns. */
export type SpaceFixture = {
  /** The Space's folder, as a real path. */
  root: string;
  paths: SpacePaths;
  /** The manifest as it was written to `lore/space.md`. */
  manifest: SpaceManifest;
  /** The Space repository. Its scaffold is committed and pushed; the working tree is clean. */
  space: TempGitRepo;
  /** The bare repository that is the Space repository's `origin`. */
  remote: TempGitRepo;
  /** The SHA of the Space repository's one commit. */
  head: string;
  repositories: SpaceFixtureRepository[];
  /** The folder of each publish area outside the Space, by name. */
  outsidePublishAreas: Record<string, string>;
  /** Remove everything the builder created. Safe to call twice. */
  cleanup: () => void;
};

const git = createGitPort(execFileRunner);
const BASE_DATE = '2026-01-05T10:00:00Z';
const WORK_DATE = '2026-01-06T10:00:00Z';
const SCAFFOLD_DATE = '2026-01-07T10:00:00Z';

function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.ok) throw new Error(`fixture: ${result.error.message}`);
  return result.value;
}

/**
 * Several lines, so that git reads the moved file as a rename. Every line
 * carries the name, so that two files share no line and git does not pair a
 * deleted file with an added one.
 */
function moduleText(name: string): string {
  const lines = [1, 2, 3, 4, 5, 6].map(
    (index) => `export const ${name}${index} = '${name} line ${index}';`,
  );
  return [`// ${name}`, ...lines, ''].join('\n');
}

/** Build one repository of the Space, with the scripted history, under `reposDir`. */
async function makeRepository(
  tempDir: string,
  reposDir: string,
  name: string,
  owner: string,
): Promise<SpaceFixtureRepository> {
  const remote = await makeTempGitRepo({
    dir: join(tempDir, 'remotes', `${name}.git`),
    bare: true,
  });
  const seed = await makeTempGitRepo({ dir: join(tempDir, 'seeds', name) });
  seed.write('README.md', `# ${name}\n\nA repository of the Space fixture.\n`);
  seed.write('src/keep.ts', moduleText('keep'));
  seed.write('src/change-me.ts', moduleText('changeMe'));
  seed.write('src/delete-me.ts', moduleText('deleteMe'));
  seed.write('src/rename-me.ts', moduleText('renameMe'));
  seed.write('docs/edit-uncommitted.md', '# Edited later\n\nFirst text.\n');
  seed.write('docs/delete-uncommitted.md', '# Deleted later\n');
  const baseCommit = await seed.commitAll('Base of the scripted history', { date: BASE_DATE });
  unwrap(await git.addRemote(seed.dir, 'origin', remote.dir));
  unwrap(await git.push(seed.dir, { setUpstream: true }));

  const checkout = await cloneTempRepo(remote.dir, join(reposDir, name));
  checkout.write('src/added.ts', moduleText('added'));
  checkout.write('src/change-me.ts', `${moduleText('changeMe')}export const changed = true;\n`);
  checkout.remove('src/delete-me.ts');
  await checkout.git('mv', 'src/rename-me.ts', 'src/renamed.ts');
  const headCommit = await checkout.commitAll('Add, change, delete and rename', {
    date: WORK_DATE,
  });

  checkout.write('docs/edit-uncommitted.md', '# Edited later\n\nSecond text, not committed.\n');
  checkout.remove('docs/delete-uncommitted.md');
  checkout.write('notes/untracked.md', '# A new file that is not committed\n');

  return {
    name,
    github: `${owner}/${name}`,
    checkout,
    remote,
    baseCommit,
    headCommit,
    committedSinceBase: [
      { status: 'added', path: 'src/added.ts' },
      { status: 'changed', path: 'src/change-me.ts' },
      { status: 'deleted', path: 'src/delete-me.ts' },
      { status: 'renamed', path: 'src/renamed.ts', from: 'src/rename-me.ts' },
    ],
    uncommitted: [
      { status: 'added', path: 'notes/untracked.md' },
      { status: 'changed', path: 'docs/edit-uncommitted.md' },
      { status: 'deleted', path: 'docs/delete-uncommitted.md' },
    ],
  };
}

/**
 * Build the Space fixture. The Lore is a copy of the template with the
 * manifest filled in; `.gitignore` comes from `gitignore.template`; the
 * Workbench folders and `repos/` exist; the Space repository has one commit,
 * pushed to a bare remote.
 */
export async function makeSpaceFixture(options: SpaceFixtureOptions): Promise<SpaceFixture> {
  const temp = makeTempDir('ai-lore-space-');
  try {
    const name = options.name ?? 'fixture-space';
    const owner = options.owner ?? 'fixture-owner';
    const root = join(temp.dir, name);
    const paths = spacePaths(root);

    unwrap(await copyTree(options.templateDir, root, { exclude: ['gitignore.template'] }));
    const ignore = readFileSync(join(options.templateDir, 'gitignore.template'), 'utf8');
    writeFileSync(join(root, '.gitignore'), ignore, 'utf8');
    for (const dir of [paths.repos, paths.drafts, paths.journal, paths.scratch]) {
      mkdirSync(dir, { recursive: true });
    }

    const repositories: SpaceFixtureRepository[] = [];
    for (const repository of options.repositories ?? []) {
      repositories.push(await makeRepository(temp.dir, paths.repos, repository, owner));
    }
    const outsidePublishAreas: Record<string, string> = {};
    for (const area of options.outsidePublishAreas ?? []) {
      const dir = join(temp.dir, 'outside', area);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.md'), `# ${area}\n`, 'utf8');
      outsidePublishAreas[area] = dir;
    }

    const template = unwrap(await readSpaceManifest(root));
    const manifest: SpaceManifest = {
      ...template,
      name,
      github: { ...template.github, repository: `${owner}/${name}`, project: options.project ?? 7 },
      repositories: repositories.map((repository) => ({
        name: repository.name,
        github: repository.github,
      })),
      publishAreas: [
        ...template.publishAreas,
        ...Object.keys(outsidePublishAreas).map((area) => ({ name: area, path: null })),
      ],
    };
    unwrap(await writeSpaceManifest(root, manifest));

    const remote = await makeTempGitRepo({
      dir: join(temp.dir, 'remotes', 'space.git'),
      bare: true,
    });
    const space = await makeTempGitRepo({ dir: root });
    const head = await space.commitAll('Scaffold the Space', { date: SCAFFOLD_DATE });
    unwrap(await git.addRemote(root, 'origin', remote.dir));
    unwrap(await git.push(root, { setUpstream: true }));

    return {
      root,
      paths,
      manifest,
      space,
      remote,
      head,
      repositories,
      outsidePublishAreas,
      cleanup: temp.cleanup,
    };
  } catch (caught) {
    temp.cleanup();
    throw caught;
  }
}
