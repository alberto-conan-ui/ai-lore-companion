/**
 * The v0.8 reader: `readV08Project` reads an AI-Lore v0.8 project into a
 * `V08Description`, which the migration plan turns into steps.
 *
 * It only reads. It has no write function, and the git commands it runs are
 * `rev-parse`, `status` and `remote get-url`, each with
 * `--no-optional-locks`, so that not even git's index file is rewritten.
 *
 * What cannot be read is data, not an exception: every file that could not be
 * read is listed in `problems` with a sentence. A symbolic link is followed
 * only when it points at a file inside the folder the archive copy takes
 * (`memory/` or `references/`, or the Lore folder for a link at its top); any
 * other link is listed and reported. A file is read into memory only when its
 * text is needed and it is under the text size cap; hashes are streamed. The
 * listing stops at a file limit and at a time limit, and the description then
 * says it is not complete.
 */

import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { basename, join, posix, resolve } from 'node:path';
import { type LegacyVersionStanding, detectFolder } from '../detect/detect-folder.js';
import { createGitPort, runGit } from '../exec/git-port.js';
import { type CommandRunner, runSucceeded } from '../exec/runner.js';
import { sha256File } from '../fs/copy-tree.js';
import { isInsideLexically } from '../fs/paths.js';
import { type Result, errorMessage, ok } from '../result.js';
import {
  type V08ParsedDocument,
  bodyUnderTitle,
  findV08Handover,
  firstParagraph,
  markdownImageLinks,
  mirrorProse,
  normaliseV08Status,
  parseV08Document,
  parseV08Stack,
  readV08BacklogEntries,
  splitV08Body,
} from './v08-markdown.js';
import type {
  V08ArchiveSummary,
  V08BacklogFile,
  V08Contract,
  V08Description,
  V08DescriptionCandidate,
  V08Document,
  V08File,
  V08FileCategory,
  V08FinishedFocus,
  V08Focus,
  V08Journal,
  V08JournalEntry,
  V08LinkStanding,
  V08MirrorNode,
  V08Note,
  V08Notepad,
  V08Phase,
  V08Problem,
  V08ReadFailure,
  V08ReadFailureKind,
  V08ReadOptions,
  V08Repository,
  V08Stage,
} from './v08-types.js';

/** What `readV08Project` needs from its caller. */
export type V08ReadDeps = {
  /** Runs the read-only git commands. */
  runner: CommandRunner;
};

/**
 * The defaults of `V08ReadOptions`. The two groups are the wording of the
 * MVP focus's `references:` rows: "Product document (…)" and "Critique and
 * decisions".
 */
export const V08_READ_DEFAULTS = {
  productDocumentGroup: 'Product document',
  critiqueNoteGroup: 'Critique',
  imageExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
  hashes: false,
  maxFiles: 20_000,
  timeBudgetMs: 30_000,
  maxTextBytes: 2 * 1024 * 1024,
  gitTimeoutMs: 15_000,
} as const;

/** The two folders of the Lore folder that the archive copy takes. */
export const V08_ARCHIVE_ROOTS = ['memory', 'references'] as const;

type Settings = Required<Omit<V08ReadOptions, 'productDocumentPath' | 'critiqueNotePath'>> &
  Pick<V08ReadOptions, 'productDocumentPath' | 'critiqueNotePath'>;

/** A file of the listing, before it is classified. `rel` is relative to the Lore folder. */
type Listed = {
  rel: string;
  size: number;
  link: { target: string; standing: V08LinkStanding } | null;
};

type Walk = { files: Listed[]; emptyFolders: string[]; stopped: string | null };

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

function failure(
  kind: V08ReadFailureKind,
  message: string,
  about: {
    projectName?: string | null;
    coreVersion?: string | null;
    versionStanding?: LegacyVersionStanding | null;
  } = {},
): { ok: false; error: V08ReadFailure } {
  return {
    ok: false,
    error: {
      kind,
      message,
      projectName: about.projectName ?? null,
      coreVersion: about.coreVersion ?? null,
      versionStanding: about.versionStanding ?? null,
    },
  };
}

/**
 * Read the AI-Lore v0.8 project at `root` (the payload repository's folder).
 * A folder that is not a legacy project, or a project whose `core_version` is
 * not 0.8, gives a failure that says why; a project older than v0.8 is told to
 * upgrade to v0.8 first.
 */
export async function readV08Project(
  root: string,
  deps: V08ReadDeps,
  options: V08ReadOptions = {},
): Promise<Result<V08Description, V08ReadFailure>> {
  const settings: Settings = { ...V08_READ_DEFAULTS, ...definedOnly(options) };
  try {
    const detected = await detectFolder(resolve(root), { git: createGitPort(deps.runner) });
    if (!detected.ok) return failure('not-a-legacy-project', detected.error.message);
    const verdict = detected.value;
    if (verdict.kind !== 'legacy') {
      return failure(
        'not-a-legacy-project',
        `This folder is not an AI-Lore project of v0.8 or older. ${verdict.reason}`,
      );
    }
    const about = {
      projectName: verdict.projectName,
      coreVersion: verdict.coreVersion,
      versionStanding: verdict.versionStanding,
    };
    const shown = verdict.coreVersion ?? 'no version';
    if (verdict.versionStanding === 'older') {
      return failure(
        'older-than-v0.8',
        `${verdict.projectName} is an AI-Lore project of core version ${shown}. Migration reads v0.8 only: upgrade the project to v0.8 first, with the upgrade verb of AI-Lore v0.8.`,
        about,
      );
    }
    if (verdict.versionStanding === 'newer') {
      return failure(
        'newer-than-v0.8',
        `${verdict.projectName} has core version ${shown}, which is newer than v0.8 and not known to this companion.`,
        about,
      );
    }
    if (verdict.versionStanding === 'unknown') {
      return failure(
        'unknown-version',
        `The manifest of ${verdict.projectName} has ${verdict.coreVersion === null ? 'no core_version' : `the core_version "${shown}", which is not a version number`}; migration reads v0.8 only.`,
        about,
      );
    }
    return ok(
      await describe(verdict.root, verdict.lorePath, verdict, deps.runner, settings, about),
    );
  } catch (caught) {
    // Nothing above is expected to throw; an unforeseen error is still a failure, not an exception.
    return failure(
      'read-failed',
      `The project at ${root} could not be read: ${errorMessage(caught)}`,
    );
  }
}

function definedOnly(options: V08ReadOptions): Partial<V08ReadOptions> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as Partial<V08ReadOptions>;
}

// ----------------------------------------------------------------------------
// The description
// ----------------------------------------------------------------------------

async function describe(
  rootIn: string,
  lorePathIn: string,
  verdict: {
    projectName: string;
    coreVersion: string | null;
    manifestLocation: 'lore-folder' | 'memory-folder';
  },
  runner: CommandRunner,
  settings: Settings,
  about: { versionStanding: LegacyVersionStanding },
): Promise<V08Description> {
  const root = resolve(rootIn);
  const lorePath = resolve(lorePathIn);
  const loreFolder = basename(lorePath);
  const shown = (rel: string): string => `${loreFolder}/${rel}`;
  const problems: V08Problem[] = [];
  const deadline = Date.now() + settings.timeBudgetMs;

  const walk = await walkLore(lorePath, settings, deadline, problems, shown);
  const byRel = new Map(walk.files.map((file) => [file.rel, file]));
  /** The files that can be read: plain files, and links that point at a file inside. */
  const readable = walk.files.filter(
    (file) => file.link === null || file.link.standing === 'inside',
  );
  const readableRels = new Set(readable.map((file) => file.rel));

  const texts = new Map<string, V08ParsedDocument | null>();
  const readDoc = async (rel: string): Promise<V08ParsedDocument | null> => {
    if (texts.has(rel)) return texts.get(rel) ?? null;
    const listed = byRel.get(rel);
    let parsed: V08ParsedDocument | null = null;
    if (listed !== undefined && readableRels.has(rel)) {
      const text = await readText(
        join(lorePath, ...rel.split('/')),
        shown(rel),
        listed.size,
        settings,
        problems,
      );
      if (text !== null) {
        parsed = parseV08Document(text);
        if (parsed.frontmatter.problem !== null) {
          problems.push({
            path: shown(rel),
            kind: 'bad-frontmatter',
            message: `${shown(rel)}: ${parsed.frontmatter.problem}`,
          });
        }
      }
    }
    texts.set(rel, parsed);
    return parsed;
  };
  const documentOf = async (
    rel: string,
  ): Promise<V08Document & { parsed: V08ParsedDocument | null }> => {
    const parsed = await readDoc(rel);
    return {
      path: shown(rel),
      title: titleOf(parsed),
      updated: parsed?.frontmatter.fields.updated ?? null,
      size: byRel.get(rel)?.size ?? 0,
      parsed,
    };
  };
  const plain = <T extends { parsed: unknown }>(value: T): Omit<T, 'parsed'> => {
    const { parsed: _parsed, ...rest } = value;
    return rest;
  };
  const rels = (predicate: (rel: string) => boolean): string[] =>
    readable
      .map((file) => file.rel)
      .filter(predicate)
      .sort();

  // --- repositories ---
  const [payloadRepository, loreRepository] = await Promise.all([
    readRepository(runner, root, '.', settings, problems),
    readRepository(runner, join(lorePath, 'memory'), shown('memory'), settings, problems),
  ]);

  // --- status: the registry and the focuses ---
  const stackRel = 'memory/status/status.stack.md';
  const stackDoc = readableRels.has(stackRel) ? await readDoc(stackRel) : null;
  if (!byRel.has(stackRel)) {
    problems.push({
      path: shown(stackRel),
      kind: 'missing',
      message: `${shown(stackRel)}, the focus registry, is not there; the focuses are taken from the folders under status/.`,
    });
  }
  const focuses = await readFocuses(
    stackDoc,
    rels,
    readDoc,
    documentOf,
    plain,
    walk.files,
    problems,
    shown,
  );
  const finishedFocuses = await readFinishedFocuses(walk.files, readDoc, shown);

  const backlog: V08BacklogFile[] = [];
  for (const rel of rels((r) => categoryOf(r) === 'backlog')) {
    const doc = await documentOf(rel);
    const body = doc.parsed?.body ?? '';
    if (rel.endsWith('.item.md')) {
      // An item file of the v0.8 backlog is one entry: its title and its whole body.
      backlog.push({
        ...plain(doc),
        entries: [{ title: doc.title ?? basename(rel, '.item.md'), text: bodyUnderTitle(body) }],
        entriesFrom: 'whole-file',
      });
      continue;
    }
    backlog.push({ ...plain(doc), ...readV08BacklogEntries(body) });
  }

  const journal = await readJournal(rels, walk.files, documentOf, plain);

  // --- blueprint ---
  const contracts: V08Contract[] = [];
  for (const rel of rels(
    (r) => r.startsWith('memory/blueprint/contracts/') && categoryOf(r) === 'project-contract',
  )) {
    const doc = await documentOf(rel);
    const body = doc.parsed?.body ?? '';
    const sections = splitV08Body(body).sections;
    const ruleSection = sections.find((section) => /^the contract\b/i.test(section.heading));
    contracts.push({
      ...plain(doc),
      rule: ruleSection?.text ?? bodyUnderTitle(body),
      ruleSource: ruleSection === undefined ? 'whole-body' : 'the-contract-section',
      holdsSeveral: ruleSection === undefined && sections.length >= 2,
      sections,
    });
  }
  const mirror: V08MirrorNode[] = [];
  for (const rel of rels((r) => categoryOf(r) === 'mirror')) {
    const doc = await documentOf(rel);
    mirror.push({
      ...plain(doc),
      target: rel.slice('memory/blueprint/mirror/'.length).replace(/\.mirror\.md$/, ''),
      prose: mirrorProse(doc.parsed?.body ?? ''),
    });
  }
  const documentsOf = async (category: V08FileCategory): Promise<V08Document[]> => {
    const found: V08Document[] = [];
    for (const rel of rels((r) => categoryOf(r) === category))
      found.push(plain(await documentOf(rel)));
    return found;
  };

  const notepad = await readNotepad(
    focuses,
    rels,
    readable,
    readDoc,
    documentOf,
    plain,
    settings,
    shown,
  );

  // --- the listing, classified ---
  const roles = new Map<string, V08FileCategory>();
  const unshown = (path: string | null): string | null =>
    path === null ? null : path.slice(loreFolder.length + 1);
  const productRel = unshown(notepad.productDocument);
  const critiqueRel = unshown(notepad.critiqueNote);
  if (productRel !== null) roles.set(productRel, 'product-document');
  if (critiqueRel !== null) roles.set(critiqueRel, 'critique-note');
  for (const image of notepad.productImages)
    roles.set(image.slice(loreFolder.length + 1), 'product-image');

  const files: V08File[] = [];
  for (const listed of walk.files) {
    const category = roles.get(listed.rel) ?? categoryOf(listed.rel);
    files.push({
      path: shown(listed.rel),
      size: listed.size,
      category,
      archived: isArchived(listed.rel),
      link: listed.link,
      sha256: null,
    });
  }
  if (settings.hashes) await hashFiles(lorePath, walk.files, files, problems, deadline, shown);

  const archive = summariseArchive(walk, files, shown);
  const complete = walk.stopped === null;

  return {
    root,
    loreFolder,
    project: {
      name: verdict.projectName,
      namePath: shown(
        verdict.manifestLocation === 'memory-folder' ? 'memory/workspace.yaml' : 'workspace.yaml',
      ),
      descriptionCandidates: await descriptionCandidates(root, settings, problems),
    },
    core: {
      version: verdict.coreVersion,
      standing: about.versionStanding,
      manifestPath: shown(
        verdict.manifestLocation === 'memory-folder' ? 'memory/workspace.yaml' : 'workspace.yaml',
      ),
      manifestLocation: verdict.manifestLocation,
    },
    payloadRepository,
    loreRepository,
    contracts,
    mirror,
    stackPath: byRel.has(stackRel) ? shown(stackRel) : null,
    focuses,
    finishedFocuses,
    backlog,
    journal,
    notepad,
    processes: await documentsOf('project-process'),
    toolingCards: await documentsOf('project-tooling'),
    projectVerbs: await documentsOf('project-verb'),
    savePoints: await documentsOf('save-point'),
    tracks: await documentsOf('track'),
    references: await documentsOf('reference'),
    unmatched: files.filter((file) => file.category === 'other').map((file) => file.path),
    files,
    archive,
    problems,
    complete,
  };
}

function titleOf(parsed: V08ParsedDocument | null): string | null {
  if (parsed === null) return null;
  const fromFrontmatter = parsed.frontmatter.fields.title?.trim();
  if (fromFrontmatter !== undefined && fromFrontmatter !== '') return fromFrontmatter;
  return splitV08Body(parsed.body).heading;
}

function isArchived(rel: string): boolean {
  return V08_ARCHIVE_ROOTS.some((top) => rel.startsWith(`${top}/`));
}

// ----------------------------------------------------------------------------
// Classification by path
// ----------------------------------------------------------------------------

/** What a file is, from its path relative to the Lore folder. The notepad's roles are added later. */
export function categoryOf(rel: string): V08FileCategory {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (rel === 'memory/workspace.yaml' || rel === 'workspace.yaml') return 'manifest';
  if (rel === 'ai_readme.md') return 'floor';
  if (rel.startsWith('references/')) return name.endsWith('.index.md') ? 'index' : 'reference';
  if (name.endsWith('.index.md')) return 'index';
  if (rel === 'memory/status/status.stack.md') return 'stack';
  if (rel.startsWith('memory/status/archive/')) return 'finished-focus';
  // v0.8 names a backlog item `<slug>.item.md`, in folders at any depth; older files are `*.backlog.md`.
  if (rel.startsWith('memory/status/backlog/'))
    return name.endsWith('.backlog.md') || name.endsWith('.item.md') ? 'backlog' : 'other';
  if (/^memory\/status\/[^/]+\//.test(rel)) return 'focus';
  if (rel.startsWith('memory/journal/live/'))
    return name.endsWith('.md') ? 'journal-live' : 'other';
  if (rel.startsWith('memory/journal/archive/'))
    return name.endsWith('.md') ? 'journal-archive' : 'other';
  const blueprint = /^memory\/blueprint\/(contracts|mirror|processes|tooling|verbs)\/(.+)$/.exec(
    rel,
  );
  if (blueprint?.[1] !== undefined && blueprint[2] !== undefined) {
    // Everything under a `core/` folder is the operating copy of the core, whatever its name
    // (`verbs/core/status.md`, `tooling/core/ai-lore.py`); none of it is carried.
    const inCore = blueprint[2].startsWith('core/');
    switch (blueprint[1]) {
      case 'contracts':
        if (inCore) return 'core-contract';
        return name.endsWith('.md') ? 'project-contract' : 'other';
      case 'mirror':
        return name.endsWith('.mirror.md') ? 'mirror' : 'other';
      case 'processes':
        if (inCore) return 'core-process';
        return name.endsWith('.process.md') ? 'project-process' : 'other';
      case 'tooling':
        if (inCore) return 'core-tooling';
        return name.endsWith('.tooling.md') ? 'project-tooling' : 'other';
      default:
        if (inCore) return 'core-verb';
        return name.endsWith('.verb.md') ? 'project-verb' : 'other';
    }
  }
  if (rel.startsWith('memory/notepad/')) return name.endsWith('.md') ? 'note' : 'other';
  if (/^memory\/save-points\/[^/]+\.save-point\.md$/.test(rel)) return 'save-point';
  if (/^memory\/tracks\/[^/]+\.track\.md$/.test(rel)) return 'track';
  return 'other';
}

// ----------------------------------------------------------------------------
// Listing the Lore folder
// ----------------------------------------------------------------------------

async function walkLore(
  lorePath: string,
  settings: Settings,
  deadline: number,
  problems: V08Problem[],
  shown: (rel: string) => string,
): Promise<Walk> {
  const files: Listed[] = [];
  const emptyFolders: string[] = [];
  let stopped: string | null = null;
  let counted = 0;
  const loreReal = await realpath(lorePath);
  const rootReal = new Map<string, string | null>();
  const realOf = async (top: string): Promise<string | null> => {
    if (!rootReal.has(top))
      rootReal.set(top, await realpath(join(lorePath, top)).catch(() => null));
    return rootReal.get(top) ?? null;
  };

  const stop = (reason: string): void => {
    if (stopped !== null) return;
    stopped = reason;
    problems.push({ path: shown(''), kind: 'limit-reached', message: reason });
  };

  const visit = async (dir: string, relDir: string): Promise<void> => {
    if (stopped !== null) return;
    if (Date.now() > deadline) {
      stop(
        `The read stopped after ${settings.timeBudgetMs} ms; the description lists only the files read before then.`,
      );
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (caught) {
      problems.push({
        path: shown(relDir),
        kind: 'unreadable',
        message: `The folder ${shown(relDir)} could not be listed: ${errorMessage(caught)}`,
      });
      return;
    }
    if (entries.length === 0 && relDir !== '') emptyFolders.push(shown(relDir));
    const folders: Promise<void>[] = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.name === '.git') {
        if (rel !== 'memory/.git') {
          problems.push({
            path: shown(rel),
            kind: 'nested-repository',
            message: `${shown(rel)} is the git folder of a repository inside the Lore; it is not listed, and the archive copy leaves it out.`,
          });
        }
        continue;
      }
      if (entry.isDirectory()) {
        folders.push(visit(abs, rel));
        continue;
      }
      // The count is taken before any await, so folders listed in parallel cannot pass the limit together.
      if (counted >= settings.maxFiles) {
        stop(`The read stopped at ${settings.maxFiles} files; the description lists only those.`);
        return;
      }
      counted += 1;
      if (entry.isSymbolicLink()) {
        files.push(await describeLink(abs, rel, loreReal, realOf, problems, shown));
        continue;
      }
      try {
        const info = await lstat(abs);
        files.push({ rel, size: info.size, link: null });
      } catch (caught) {
        problems.push({
          path: shown(rel),
          kind: 'unreadable',
          message: `${shown(rel)} could not be read: ${errorMessage(caught)}`,
        });
      }
    }
    await Promise.all(folders);
  };

  await visit(lorePath, '');
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  emptyFolders.sort();
  return { files, emptyFolders, stopped };
}

/** Where a link points, without following it past the folder the archive copy takes. */
async function describeLink(
  abs: string,
  rel: string,
  loreReal: string,
  realOf: (top: string) => Promise<string | null>,
  problems: V08Problem[],
  shown: (rel: string) => string,
): Promise<Listed> {
  let target = '';
  try {
    target = await readlink(abs);
  } catch (caught) {
    problems.push({
      path: shown(rel),
      kind: 'unreadable',
      message: `The link ${shown(rel)} could not be read: ${errorMessage(caught)}`,
    });
    return { rel, size: 0, link: { target, standing: 'broken' } };
  }
  const top = rel.split('/')[0] ?? '';
  const base = (V08_ARCHIVE_ROOTS as readonly string[]).includes(top)
    ? await realOf(top)
    : loreReal;
  const where = base === loreReal ? 'the Lore folder' : `${shown(top)}/`;
  let resolved: string;
  try {
    resolved = await realpath(abs);
  } catch {
    problems.push({
      path: shown(rel),
      kind: 'broken-link',
      message: `The link ${shown(rel)} points at ${target}, which is not there.`,
    });
    return { rel, size: 0, link: { target, standing: 'broken' } };
  }
  if (base === null || !isInsideLexically(base, resolved)) {
    problems.push({
      path: shown(rel),
      kind: 'outside-link',
      message: `The link ${shown(rel)} points at ${target}, outside ${where}; it is not followed, and the archive copy cannot take it.`,
    });
    return { rel, size: 0, link: { target, standing: 'outside' } };
  }
  const info = await stat(resolved).catch(() => null);
  if (info === null || !info.isFile()) {
    problems.push({
      path: shown(rel),
      kind: 'folder-link',
      message: `The link ${shown(rel)} points at ${target}, which is not a file; it is not followed.`,
    });
    return { rel, size: 0, link: { target, standing: 'folder' } };
  }
  return { rel, size: info.size, link: { target, standing: 'inside' } };
}

async function readText(
  abs: string,
  path: string,
  size: number,
  settings: Settings,
  problems: V08Problem[],
): Promise<string | null> {
  if (size > settings.maxTextBytes) {
    problems.push({
      path,
      kind: 'too-large',
      message: `${path} is ${size} bytes, larger than the ${settings.maxTextBytes} bytes the reader reads as text; it is listed with its size only.`,
    });
    return null;
  }
  try {
    return await readFile(abs, 'utf8');
  } catch (caught) {
    problems.push({
      path,
      kind: 'unreadable',
      message: `${path} could not be read: ${errorMessage(caught)}`,
    });
    return null;
  }
}

async function hashFiles(
  lorePath: string,
  listed: readonly Listed[],
  files: V08File[],
  problems: V08Problem[],
  deadline: number,
  shown: (rel: string) => string,
): Promise<void> {
  const queue = listed
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        isArchived(entry.rel) && (entry.link === null || entry.link.standing === 'inside'),
    );
  let next = 0;
  let late = false;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const item = queue[next];
      next += 1;
      if (item === undefined) return;
      if (Date.now() > deadline) {
        late = true;
        return;
      }
      const hash = await sha256File(join(lorePath, ...item.entry.rel.split('/')));
      const file = files[item.index];
      if (file === undefined) continue;
      if (hash.ok) file.sha256 = hash.value;
      else
        problems.push({
          path: shown(item.entry.rel),
          kind: 'unreadable',
          message: `${shown(item.entry.rel)} could not be read for its hash: ${hash.error.message}`,
        });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (late) {
    problems.push({
      path: shown(''),
      kind: 'limit-reached',
      message: 'The time limit was reached while hashing; some archived files have no hash.',
    });
  }
}

function summariseArchive(
  walk: Walk,
  files: readonly V08File[],
  shown: (rel: string) => string,
): V08ArchiveSummary {
  const archived = files.filter((file) => file.archived);
  const copied = archived.filter((file) => file.link === null || file.link.standing === 'inside');
  const present = new Set(files.map((file) => file.path.split('/')[1]));
  return {
    roots: V08_ARCHIVE_ROOTS.filter((top) => present.has(top)).map((top) => shown(top)),
    fileCount: copied.length,
    totalBytes: copied.reduce((sum, file) => sum + file.size, 0),
    linkCount: archived.filter((file) => file.link !== null).length,
    refusedLinks: archived
      .filter((file) => file.link !== null && file.link.standing !== 'inside')
      .map((file) => file.path),
    emptyFolders: walk.emptyFolders.filter((folder) =>
      V08_ARCHIVE_ROOTS.some((top) => folder.startsWith(`${shown(top)}/`)),
    ),
  };
}

// ----------------------------------------------------------------------------
// Repositories
// ----------------------------------------------------------------------------

async function readRepository(
  runner: CommandRunner,
  dir: string,
  path: string,
  settings: Settings,
  problems: V08Problem[],
): Promise<V08Repository> {
  const absent: V08Repository = {
    path,
    present: false,
    originUrl: null,
    branch: null,
    detached: false,
    head: null,
    hasUncommittedChanges: false,
    statusText: '',
    changedCount: 0,
  };
  const git = (args: string[]) =>
    runGit(runner, dir, args, { readOnly: true, timeoutMs: settings.gitTimeoutMs });
  const top = await git(['rev-parse', '--show-toplevel']);
  const wanted = await realpath(dir).catch(() => null);
  const topReal = runSucceeded(top) ? await realpath(top.stdout.trim()).catch(() => null) : null;
  if (wanted === null || topReal === null || topReal !== wanted) {
    problems.push({
      path,
      kind: 'repository',
      message: `${path} is not the top of a git repository of its own, so its origin, branch, head and changes are not known.`,
    });
    return absent;
  }
  const [head, branch, origin, status] = await Promise.all([
    git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['remote', 'get-url', 'origin']),
    git(['-c', 'core.quotepath=false', 'status', '--porcelain']),
  ]);
  const branchName = runSucceeded(branch) ? branch.stdout.trim() : '';
  if (!runSucceeded(status)) {
    problems.push({
      path,
      kind: 'repository',
      message: `git status could not be read in ${path}: ${status.stderr.trim() || `exit code ${status.code}`}`,
    });
  }
  const statusText = runSucceeded(status) ? status.stdout.replace(/\n+$/, '') : '';
  const changedCount = statusText === '' ? 0 : statusText.split('\n').length;
  return {
    path,
    present: true,
    originUrl: runSucceeded(origin) ? origin.stdout.trim() || null : null,
    branch: branchName === '' || branchName === 'HEAD' ? null : branchName,
    detached: branchName === 'HEAD',
    head: runSucceeded(head) ? head.stdout.trim() || null : null,
    hasUncommittedChanges: changedCount > 0,
    statusText,
    changedCount,
  };
}

async function descriptionCandidates(
  root: string,
  settings: Settings,
  problems: V08Problem[],
): Promise<V08DescriptionCandidate[]> {
  const found: V08DescriptionCandidate[] = [];
  const small = async (name: string): Promise<string | null> => {
    const info = await lstat(join(root, name)).catch(() => null);
    if (info === null || !info.isFile()) return null;
    return readText(join(root, name), name, info.size, settings, problems);
  };
  const pkg = await small('package.json');
  if (pkg !== null) {
    try {
      const value: unknown = JSON.parse(pkg);
      const text =
        typeof value === 'object' && value !== null
          ? (value as { description?: unknown }).description
          : undefined;
      if (typeof text === 'string' && text.trim() !== '')
        found.push({ path: 'package.json', text: text.trim() });
    } catch {
      problems.push({
        path: 'package.json',
        kind: 'unreadable',
        message: 'package.json is not valid JSON; its description is not offered.',
      });
    }
  }
  const readme = await small('README.md');
  if (readme !== null) {
    const text = firstParagraph(parseV08Document(readme).body);
    if (text !== null) found.push({ path: 'README.md', text });
  }
  return found;
}

// ----------------------------------------------------------------------------
// Focuses
// ----------------------------------------------------------------------------

type ReadDoc = (rel: string) => Promise<V08ParsedDocument | null>;
type DocumentOf = (rel: string) => Promise<V08Document & { parsed: V08ParsedDocument | null }>;
type Plain = <T extends { parsed: unknown }>(value: T) => Omit<T, 'parsed'>;
type Rels = (predicate: (rel: string) => boolean) => string[];

/** Join a link to the folder of the file that holds it; `null` when it leaves the Lore folder. */
function joinRelative(fromFile: string, link: string): string | null {
  const address = link.split('#')[0]?.trim() ?? '';
  if (address === '' || /^[a-z]+:/i.test(address) || address.startsWith('/')) return null;
  const joined = posix.normalize(
    posix.join(posix.dirname(fromFile), decodeURIComponentSafe(address)),
  );
  return joined.startsWith('../') || joined === '..' ? null : joined;
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

async function readFocuses(
  stackDoc: V08ParsedDocument | null,
  rels: Rels,
  readDoc: ReadDoc,
  documentOf: DocumentOf,
  plain: Plain,
  listed: readonly Listed[],
  problems: V08Problem[],
  shown: (rel: string) => string,
): Promise<V08Focus[]> {
  const stackRel = 'memory/status/status.stack.md';
  const rows = stackDoc === null ? [] : parseV08Stack(stackDoc.body);
  const focuses: V08Focus[] = [];
  const seenFolders = new Set<string>();
  const countUnder = (folder: string): number =>
    listed.filter((file) => file.rel.startsWith(`${folder}/`)).length;

  const build = async (
    name: string,
    bodyRel: string | null,
    row: { statusText: string; activeTrack: string | null } | null,
  ): Promise<V08Focus> => {
    const exists = bodyRel !== null && rels((r) => r === bodyRel).length === 1;
    const folderRel =
      bodyRel !== null && /^memory\/status\/[^/]+\/[^/]+$/.test(bodyRel)
        ? posix.dirname(bodyRel)
        : null;
    if (folderRel !== null) seenFolders.add(folderRel);
    const parsed = exists && bodyRel !== null ? await readDoc(bodyRel) : null;
    const statusInFile = parsed?.frontmatter.fields.status ?? null;
    const statusText = row?.statusText ?? statusInFile;
    const stages: V08Stage[] = [];
    const loosePhases: V08Phase[] = [];
    if (folderRel !== null) {
      const stageRels = rels((r) => r.startsWith(`${folderRel}/`) && r.endsWith('.stage.md'));
      for (const stageRel of stageRels) {
        const doc = await documentOf(stageRel);
        const text = doc.parsed?.frontmatter.fields.status ?? null;
        stages.push({
          ...plain(doc),
          folderPath: shown(posix.dirname(stageRel)),
          status: normaliseV08Status(text),
          statusText: text,
          phases: [],
        });
      }
      for (const phaseRel of rels(
        (r) => r.startsWith(`${folderRel}/`) && r.endsWith('.phase.md'),
      )) {
        const doc = await documentOf(phaseRel);
        const text = doc.parsed?.frontmatter.fields.status ?? null;
        const phase: V08Phase = {
          ...plain(doc),
          status: normaliseV08Status(text),
          statusText: text,
        };
        // The deepest stage whose folder holds the phase.
        const owner = stages
          .filter(
            (stage) =>
              stage.folderPath !== shown(folderRel) &&
              phase.path.startsWith(`${stage.folderPath}/`),
          )
          .sort((a, b) => b.folderPath.length - a.folderPath.length)[0];
        if (owner === undefined) loosePhases.push(phase);
        else owner.phases.push(phase);
      }
    }
    return {
      name,
      title: titleOf(parsed),
      status: normaliseV08Status(statusText),
      statusText,
      statusInFile,
      activeTrack: row?.activeTrack ?? null,
      inStack: row !== null,
      bodyPath: exists && bodyRel !== null ? shown(bodyRel) : null,
      folderPath: folderRel === null ? null : shown(folderRel),
      references: parsed?.frontmatter.references ?? [],
      stages,
      loosePhases,
      fileCount: folderRel === null ? (exists ? 1 : 0) : countUnder(folderRel),
    };
  };

  for (const row of rows) {
    const bodyRel = joinRelative(stackRel, row.link);
    const focus = await build(row.name, bodyRel, row);
    if (focus.bodyPath === null) {
      problems.push({
        path: shown(stackRel),
        kind: 'missing',
        message: `The registry row ${row.name} links to ${row.link}, which is not a file of the Lore.`,
      });
    }
    focuses.push(focus);
  }
  // Focus folders the registry does not name.
  const folders = new Set(
    rels(
      (r) =>
        /^memory\/status\/[^/]+\/[^/]+\.focus\.md$/.test(r) &&
        !/^memory\/status\/(archive|backlog)\//.test(r),
    ).map((r) => posix.dirname(r)),
  );
  for (const folder of [...folders].sort()) {
    if (seenFolders.has(folder)) continue;
    const name = folder.slice('memory/status/'.length);
    const own = `${folder}/${name}.focus.md`;
    const bodyRel =
      rels((r) => r === own).length === 1
        ? own
        : (rels((r) => posix.dirname(r) === folder && r.endsWith('.focus.md'))[0] ?? null);
    focuses.push(await build(name, bodyRel, null));
  }
  return focuses;
}

async function readFinishedFocuses(
  listed: readonly Listed[],
  readDoc: ReadDoc,
  shown: (rel: string) => string,
): Promise<V08FinishedFocus[]> {
  const prefix = 'memory/status/archive/';
  const names = new Map<string, { file: string | null; folder: string | null }>();
  for (const file of listed) {
    if (!file.rel.startsWith(prefix)) continue;
    const rest = file.rel.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (!rest.endsWith('.focus.md')) continue;
      const name = rest.slice(0, -'.focus.md'.length);
      const entry = names.get(name) ?? { file: null, folder: null };
      entry.file = file.rel;
      names.set(name, entry);
    } else {
      const name = rest.slice(0, slash);
      const entry = names.get(name) ?? { file: null, folder: null };
      entry.folder = `${prefix}${name}`;
      names.set(name, entry);
    }
  }
  const readable = new Set(
    listed
      .filter((file) => file.link === null || file.link.standing === 'inside')
      .map((file) => file.rel),
  );
  const found: V08FinishedFocus[] = [];
  for (const [name, entry] of [...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let body = entry.file;
    if (body === null && entry.folder !== null) {
      const own = `${entry.folder}/${name}.focus.md`;
      body = readable.has(own)
        ? own
        : ([...readable]
            .filter((rel) => posix.dirname(rel) === entry.folder && rel.endsWith('.focus.md'))
            .sort()[0] ?? null);
    }
    const parsed = body === null ? null : await readDoc(body);
    // A folder with no focus file (older archived work) still has a title in its index.
    const index = entry.folder === null ? null : `${entry.folder}/${name}.index.md`;
    const titled =
      parsed === null && index !== null && readable.has(index) ? await readDoc(index) : parsed;
    const inFolder =
      entry.folder === null
        ? 0
        : listed.filter((file) => file.rel.startsWith(`${entry.folder}/`)).length;
    found.push({
      name,
      title: titleOf(titled),
      statusText: parsed?.frontmatter.fields.status ?? null,
      bodyPath: body === null ? null : shown(body),
      folderPath: entry.folder === null ? null : shown(entry.folder),
      fileCount: inFolder + (entry.file === null ? 0 : 1),
    });
  }
  return found;
}

// ----------------------------------------------------------------------------
// Journal and notepad
// ----------------------------------------------------------------------------

async function readJournal(
  rels: Rels,
  listed: readonly Listed[],
  documentOf: DocumentOf,
  plain: Plain,
): Promise<V08Journal> {
  const read: { entry: V08JournalEntry; body: string; rel: string }[] = [];
  for (const rel of rels((r) => categoryOf(r) === 'journal-live')) {
    const doc = await documentOf(rel);
    const fields = doc.parsed?.frontmatter.fields ?? {};
    const fromName = /^([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(basename(rel))?.[1] ?? null;
    const fromField = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.exec(fields.date ?? '')?.[0] ?? null;
    read.push({
      entry: {
        ...plain(doc),
        date: fromField ?? fromName,
        session: fields.session ?? null,
        track: fields.track ?? null,
      },
      body: doc.parsed?.body ?? '',
      rel,
    });
  }
  // The date is fixed width, so a space between it and the name keeps the order.
  const key = (item: { entry: V08JournalEntry; rel: string }): string =>
    `${item.entry.date ?? ''} ${basename(item.rel)}`;
  read.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  let newestHandover: V08Journal['newestHandover'] = null;
  for (let index = read.length - 1; index >= 0; index -= 1) {
    const item = read[index];
    if (item === undefined) continue;
    const section = findV08Handover(item.body);
    if (section !== null) {
      newestHandover = {
        path: item.entry.path,
        heading: section.heading,
        text: section.text,
        fromNewestEntry: index === read.length - 1,
      };
      break;
    }
  }
  return {
    entries: read.map((item) => item.entry),
    newestEntry: read[read.length - 1]?.entry.path ?? null,
    newestHandover,
    archivedCount: listed.filter((file) => categoryOf(file.rel) === 'journal-archive').length,
  };
}

async function readNotepad(
  focuses: readonly V08Focus[],
  rels: Rels,
  readable: readonly Listed[],
  readDoc: ReadDoc,
  documentOf: DocumentOf,
  plain: Plain,
  settings: Settings,
  shown: (rel: string) => string,
): Promise<V08Notepad> {
  const loreFolder = shown('').replace(/\/$/, '');
  const fromRoot = (path: string | undefined): string | null => {
    if (path === undefined) return null;
    const clean = posix.normalize(path.replace(/\\/g, '/'));
    return clean.startsWith(`${loreFolder}/`) ? clean.slice(loreFolder.length + 1) : null;
  };
  const exists = (rel: string | null): string | null =>
    rel !== null && rels((r) => r === rel).length === 1 ? rel : null;
  const inProgress =
    focuses.find((focus) => focus.status === 'in progress' && focus.bodyPath !== null) ?? null;
  const byGroup = (group: string): string | null => {
    if (inProgress?.bodyPath === null || inProgress === null) return null;
    const bodyRel = inProgress.bodyPath.slice(loreFolder.length + 1);
    const row = inProgress.references.find((reference) =>
      reference.group.trim().toLowerCase().startsWith(group.toLowerCase()),
    );
    return row === undefined ? null : exists(joinRelative(bodyRel, row.path));
  };

  const productRel =
    settings.productDocumentPath !== undefined
      ? exists(fromRoot(settings.productDocumentPath))
      : byGroup(settings.productDocumentGroup);
  const critiqueRel =
    settings.critiqueNotePath !== undefined
      ? exists(fromRoot(settings.critiqueNotePath))
      : byGroup(settings.critiqueNoteGroup);

  const isImage = (rel: string): boolean =>
    settings.imageExtensions.includes(posix.extname(rel).toLowerCase());
  const images = new Set<string>();
  if (productRel !== null) {
    const parsed = await readDoc(productRel);
    for (const link of markdownImageLinks(parsed?.body ?? '')) {
      const rel = exists(joinRelative(productRel, link));
      if (rel !== null && isImage(rel)) images.add(rel);
    }
    const folder = productRel.replace(/(\.note)?\.md$/, '');
    for (const file of readable)
      if (file.rel.startsWith(`${folder}/`) && isImage(file.rel)) images.add(file.rel);
  }

  const notes: V08Note[] = [];
  for (const rel of rels((r) => categoryOf(r) === 'note')) {
    const doc = await documentOf(rel);
    notes.push({
      ...plain(doc),
      role:
        rel === productRel ? 'product-document' : rel === critiqueRel ? 'critique-note' : 'note',
    });
  }

  const how = (what: string, path: string | undefined, group: string): string =>
    path !== undefined
      ? `The ${what} is the file named by the reader's option: ${path}.`
      : `The ${what} is the file that a references row of the in-progress focus names under a group beginning with "${group}".`;
  return {
    notes,
    productDocument: productRel === null ? null : shown(productRel),
    productImages: [...images].sort().map(shown),
    critiqueNote: critiqueRel === null ? null : shown(critiqueRel),
    recognisedBy: {
      productDocument: how(
        'product document',
        settings.productDocumentPath,
        settings.productDocumentGroup,
      ),
      productImages: `Its images are the image files the product document shows with ![…](…), and every image file under the folder beside it that has its name without .note.md (${settings.imageExtensions.join(', ')}).`,
      critiqueNote: how('critique note', settings.critiqueNotePath, settings.critiqueNoteGroup),
    },
  };
}
