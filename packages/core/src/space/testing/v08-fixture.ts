/**
 * The fixture "an AI-Lore project of v0.8": a payload repository with a
 * `.ai-lore-<name>/` folder whose `memory/` is its own git repository, each
 * with a bare remote. It is built in code and is small, and it holds every
 * kind of content the migration mapping of the MVP focus names: the manifest,
 * the focus registry with one in-progress focus of three stages, two paused
 * focuses and two done focuses under `archive/` (one with a folder, one that
 * is a single file), two backlog files of which one lists several entries and
 * one backlog item file in a grouping folder, two
 * journal entries of which the newer has a handover, two project contracts as
 * files of their own and a `contracts.spec.md` that holds three more as
 * sections, beside the `core/` folder, one mirror node, a project process, a
 * tooling card, the product document with its image folder, the critique note
 * and one other note, save-points with `next.save-point.md`, tracks,
 * `references/`, and a `.claude/` binding in the payload repository. It also
 * holds what a copy "as it is" must decide about: files that the ignore rules
 * keep out of the repositories (`.DS_Store`, the editor's folder), a file with
 * spaces and characters outside ASCII in its name, a symbolic link, a file
 * with the executable bit, and an empty folder.
 *
 * The shape follows a real v0.8 project; no file of a real project is read.
 * `coreVersion` other than a `0.8` gives the older variant: the manifest at
 * the top of the Lore folder, and the older, smaller tree below it.
 */

import { chmodSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileRunner } from '../exec/exec-file-runner.js';
import { createGitPort } from '../exec/git-port.js';
import type { Result } from '../result.js';
import { type TempGitRepo, makeTempGitRepo } from './git-repo.js';
import type { FixtureChange } from './space-fixture.js';
import { makeTempDir } from './temp.js';

/** Options of `makeV08Fixture`. */
export type V08FixtureOptions = {
  /** The project's name; the Lore folder is `.ai-lore-<name>`. Default `fixture-project`. */
  name?: string;
  /**
   * The `core_version` of the manifest. Default `0.8`. `0.8` or a `0.8.x` gives
   * the v0.8 tree with the manifest at `memory/workspace.yaml`; any other value
   * (`0.7`) gives the older tree with the manifest at `workspace.yaml`.
   */
  coreVersion?: string;
  /** Leave changes that are not committed in both repositories. Default false. */
  uncommitted?: boolean;
  /**
   * Add `memory/notepad/outside.link`, a symbolic link to the payload's
   * `README.md`, which is outside the Lore folder. Archive copying must refuse
   * it, so it is not part of the default tree. It is committed with the rest.
   * Default false; the older variant ignores it.
   */
  outsideLink?: boolean;
};

/**
 * What the v0.8 tree holds, as paths relative to the Lore folder, with `/`.
 * In the older variant every list is empty and the single values are `null`.
 */
export type V08FixtureContents = {
  inProgressFocus: string | null;
  /** The stage files of the in-progress focus, in order. */
  stages: string[];
  pausedFocuses: string[];
  doneFocuses: string[];
  /** Finished focuses under `archive/` that are a folder with no focus file, as older ones are. */
  doneFocusFoldersWithoutFile: string[];
  backlogFiles: string[];
  /** Backlog items in the v0.8 shape: one `*.item.md` file each, in a folder under `backlog/`. */
  backlogItems: string[];
  /** The entries of all backlog files and item files: one migrated issue each. */
  backlogEntryCount: number;
  /** Oldest first. The last one has a `## Handover` section. */
  journalEntries: string[];
  /** The contracts outside `core/` that are one file each (`*.contract.md`). */
  projectContracts: string[];
  /** The files outside `core/` that hold several contracts, one per `##` section (`contracts.spec.md`). */
  contractSpecFiles: string[];
  /** The titles of the `##` sections of `contractSpecFiles`, in order: one contract each. */
  contractSpecSections: string[];
  mirrorNodes: string[];
  projectProcesses: string[];
  toolingCards: string[];
  productDocument: string | null;
  productImages: string[];
  critiqueNote: string | null;
  otherNotes: string[];
  savePoints: string[];
  tracks: string[];
  references: string[];
  /**
   * Files that are on the disk and that `memory/.gitignore` or the payload's
   * `.gitignore` keeps out of both repositories: `.DS_Store` files, and the
   * editor's folder at the top of the Lore folder.
   */
  ignoredFiles: string[];
  /** Files whose name has spaces and characters outside ASCII. They are committed. */
  oddNames: string[];
  /** Symbolic links, committed as links. Every one points inside the Lore folder, except `outsideLink`. */
  symlinks: string[];
  /** Files with the executable bit, which git records. */
  executableFiles: string[];
  /** Folders with nothing in them. Git does not record them; they are on the disk only. */
  emptyFolders: string[];
};

/** What `makeV08Fixture` returns. */
export type V08Fixture = {
  /** The payload repository's folder, which is the folder a Human Lead opens. */
  root: string;
  projectName: string;
  coreVersion: string;
  shape: 'v0.8' | 'older';
  manifestLocation: 'memory-folder' | 'lore-folder';
  /** `<root>/.ai-lore-<name>` */
  lorePath: string;
  /** `<lorePath>/memory`, the Lore repository. */
  memoryPath: string;
  payload: TempGitRepo;
  payloadRemote: TempGitRepo;
  payloadHead: string;
  memory: TempGitRepo;
  memoryRemote: TempGitRepo;
  memoryHead: string;
  contents: V08FixtureContents;
  /** Every file under the Lore folder, without `.git`, relative to it, sorted. */
  loreFiles: string[];
  /** The changes left uncommitted, when the option asked for them. */
  uncommitted: { payload: FixtureChange[]; memory: FixtureChange[] };
  /** Remove everything the builder created. Safe to call twice. */
  cleanup: () => void;
};

const git = createGitPort(execFileRunner);
const COMMIT_DATE = '2026-09-18T09:00:00Z';
/** A PNG of one pixel. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** A few fixed bytes that stand for the Finder's metadata file. */
const DS_STORE_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]);

/** The contracts of `contracts.spec.md`: a title and a rule each. One title has inline code, as real ones do. */
const CONTRACT_SPEC_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['Every public `core/` export has a test', 'Anything the core package exports has a test.'],
  ['Lint and tests gate every change', 'No change is merged with a failing lint or test run.'],
  ['Ignore rules carry a level', 'Every ignore rule has a level, and the default is the quietest.'],
];

/** A file of the notepad that is not markdown, with spaces and characters outside ASCII in its name. */
const ODD_NAME = 'memory/notepad/Mapa de ideas — visión 1.0.mmap';
/** A file with the executable bit, beside the tooling card that registers it. */
const EXECUTABLE = 'memory/blueprint/tooling/build-script.sh';
/** A symbolic link to a file of the same folder, and the file it points to. */
const INSIDE_LINK = 'memory/notepad/latest-critique.note.md';
const INSIDE_LINK_TARGET = 'product-critique-2026-09-18.note.md';
/** The link of the option `outsideLink`, to the payload's README, three folders up from the notepad. */
const OUTSIDE_LINK = 'memory/notepad/outside.link';
const OUTSIDE_LINK_TARGET = '../../../README.md';
const EMPTY_FOLDER = 'memory/notepad/empty-folder';
/** On the disk and in neither repository. The editor's folder is at the top of the Lore folder, as in a real project. */
const IGNORED_FILES = [
  '.DS_Store',
  '.idea/workspace.xml',
  'memory/.DS_Store',
  'memory/notepad/.DS_Store',
];

type FileTable = Record<string, string | Buffer>;

function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.ok) throw new Error(`fixture: ${result.error.message}`);
  return result.value;
}

/** A v0.8 markdown file: frontmatter with `type`, `title`, `updated` and a parent reference, then a body. */
function doc(
  type: string,
  title: string,
  parent: string,
  extra: readonly string[],
  body: readonly string[],
): string {
  return [
    '---',
    `type: ${type}`,
    `title: ${title}`,
    'updated: 2026-09-18',
    'references:',
    '  - group: Parent',
    `    path: ${parent}`,
    ...extra,
    '---',
    '',
    `# ${title}`,
    '',
    ...body,
    '',
  ].join('\n');
}

function stage(focus: string, id: string, title: string, status: string): FileTable {
  const dir = `memory/status/${focus}/${id}`;
  // `focus` is a path under `status/` (`archive/earlier-work`); its index is named for the last part.
  const focusName = focus.slice(focus.lastIndexOf('/') + 1);
  return {
    [`${dir}/${id}.index.md`]: doc(
      'index',
      `${title} (index)`,
      `../${focusName}.index.md`,
      [],
      [`- [${id}.stage.md](./${id}.stage.md)`],
    ),
    [`${dir}/${id}.stage.md`]: doc(
      'stage',
      title,
      `./${id}.index.md`,
      ['gated: true', `status: ${status}`],
      ['## Intent', '', `What ${title} is for.`, '', '## Gate', '', `- The gate of ${title}.`],
    ),
  };
}

function focusFiles(
  dir: string,
  name: string,
  title: string,
  status: string,
  extraReferences: readonly string[],
  body: readonly string[],
): FileTable {
  return {
    [`${dir}/${name}.index.md`]: doc(
      'index',
      `${title} (index)`,
      '../status.index.md',
      [],
      [`- [${name}.focus.md](./${name}.focus.md)`],
    ),
    [`${dir}/${name}.focus.md`]: [
      '---',
      'type: focus',
      `title: ${title}`,
      'updated: 2026-09-18',
      'references:',
      '  - group: Parent',
      `    path: ./${name}.index.md`,
      ...extraReferences,
      `status: ${status}`,
      'focus_type: build',
      '---',
      '',
      `# ${title}`,
      '',
      `> **Status:** ${status}.`,
      '',
      ...body,
      '',
    ].join('\n'),
  };
}

/** The files of the v0.8 tree, relative to the Lore folder, and what they are. */
function v08Tree(
  name: string,
  coreVersion: string,
): { files: FileTable; contents: V08FixtureContents } {
  const inProgress = 'build-the-thing';
  const files: FileTable = {
    'ai_readme.md': '# AI-Lore — The Floor\n\nThe bootstrap every session reads first.\n',
    'references/references.index.md': doc(
      'index',
      'References — registry',
      '../memory/memory.index.md',
      [],
      ['- [upstream.md](./upstream.md) — a project this one consults.'],
    ),
    'references/upstream.md': doc(
      'reference',
      'Upstream project',
      './references.index.md',
      [],
      ['A pointer to another project, read only.'],
    ),
    'memory/.gitignore': '# macOS Finder metadata\n.DS_Store\n',
    'memory/workspace.yaml': `project_name: ${name}\ncore_version: "${coreVersion}"\n`,
    'memory/memory.index.md': doc(
      'index',
      `${name} — Memory`,
      '../ai_readme.md',
      [],
      [
        '- [status/](./status/status.index.md)',
        '- [journal/](./journal/journal.index.md)',
        '- [blueprint/](./blueprint/blueprint.index.md)',
        '- [notepad/](./notepad/notepad.index.md)',
        '- [save-points/](./save-points/save-points.index.md)',
        '- [tracks/](./tracks/tracks.index.md)',
      ],
    ),

    // ----- status: the registry, the focuses, the backlog, the archive -----
    'memory/status/status.index.md': doc(
      'index',
      `${name} — Status`,
      '../memory.index.md',
      [],
      [
        '- [status.stack.md](./status.stack.md) — the focus registry.',
        '- [backlog/](./backlog/backlog.index.md)',
        '- [archive/](./archive/archive.index.md)',
      ],
    ),
    'memory/status/status.stack.md': doc(
      'status-stack',
      `${name} — Focus registry`,
      './status.index.md',
      [],
      [
        '| Focus | Status | Active |',
        '|---|---|---|',
        `| [${inProgress}](./${inProgress}/${inProgress}.focus.md) | in progress | home |`,
        '| [port-to-linux](./port-to-linux/port-to-linux.focus.md) | paused | |',
        '| [side-helper](./side-helper/side-helper.focus.md) | paused | |',
      ],
    ),
    ...focusFiles(
      `memory/status/${inProgress}`,
      inProgress,
      'Build the thing',
      'in progress',
      [
        '  - group: Product document',
        '    path: ../../notepad/product-document.note.md',
        '  - group: Critique and decisions',
        '    path: ../../notepad/product-critique-2026-09-18.note.md',
      ],
      [
        '## Gate',
        '',
        '- [ ] The thing is built.',
        '',
        '## Stages',
        '',
        '- [B1-first-stage.stage.md](./B1-first-stage/B1-first-stage.stage.md) (done)',
        '- [B2-second-stage.stage.md](./B2-second-stage/B2-second-stage.stage.md) (in progress)',
        '- [B3-third-stage.stage.md](./B3-third-stage/B3-third-stage.stage.md) (draft)',
      ],
    ),
    ...stage(inProgress, 'B1-first-stage', 'B1 — first stage', 'done'),
    ...stage(inProgress, 'B2-second-stage', 'B2 — second stage', 'in progress'),
    ...stage(inProgress, 'B3-third-stage', 'B3 — third stage', 'draft'),
    [`memory/status/${inProgress}/B2-second-stage/B2.1-first-step/B2.1-first-step.phase.md`]: doc(
      'phase',
      'B2.1 — first step',
      '../B2-second-stage.index.md',
      ['status: in progress'],
      ['A buildable step under the second stage.'],
    ),
    ...focusFiles(
      'memory/status/port-to-linux',
      'port-to-linux',
      'Port to Linux',
      'paused',
      [],
      ['Paused at its first stage.'],
    ),
    ...stage('port-to-linux', 'L0-first-binary', 'L0 — first binary', 'in progress'),
    ...focusFiles(
      'memory/status/side-helper',
      'side-helper',
      'The side helper',
      'paused',
      [],
      ['Paused before it was decomposed.'],
    ),
    'memory/status/archive/archive.index.md': doc(
      'index',
      'Archive',
      '../status.index.md',
      [],
      [
        '- [earlier-work/](./earlier-work/earlier-work.index.md) — done.',
        '- [single-file-work.focus.md](./single-file-work.focus.md) — done; a focus that never had stages.',
      ],
    ),
    // A real archive also holds finished focuses that are one file with no folder.
    'memory/status/archive/single-file-work.focus.md': doc(
      'focus',
      'Single-file work',
      './archive.index.md',
      ['status: done'],
      ['Finished without stages, and archived as one file.'],
    ),
    ...focusFiles(
      'memory/status/archive/earlier-work',
      'earlier-work',
      'Earlier work',
      'done',
      [],
      ['Finished and archived.'],
    ),
    ...stage('archive/earlier-work', 'E1-only-stage', 'E1 — the only stage', 'done'),
    // A real archive also holds finished focuses from before focus files: a folder with an index and phase files only.
    'memory/status/archive/first-prototype/first-prototype.index.md': doc(
      'index',
      'First prototype',
      '../archive.index.md',
      [],
      ['- [01-skeleton.phase.md](./01-skeleton.phase.md)'],
    ),
    'memory/status/archive/first-prototype/01-skeleton.phase.md': doc(
      'phase',
      'Skeleton',
      './first-prototype.index.md',
      ['status: Achieved'],
      ['The first phase of the prototype.'],
    ),
    'memory/status/backlog/backlog.index.md': doc(
      'index',
      'Backlog',
      '../status.index.md',
      [],
      [
        '- [parked-work.backlog.md](./parked-work.backlog.md)',
        '- [upgrade-findings.backlog.md](./upgrade-findings.backlog.md)',
        '- [ideas/](./ideas/ideas.index.md)',
      ],
    ),
    // A real backlog file opens with a Purpose section and ends with a Journal trail; neither is an entry.
    'memory/status/backlog/parked-work.backlog.md': doc(
      'backlog',
      'Parked work',
      './backlog.index.md',
      [],
      [
        '## Purpose',
        '',
        'Work that is real but not live.',
        '',
        '## A first parked item',
        '',
        'Text of the first item.',
        '',
        '## A second parked item',
        '',
        'Text of the second item.',
        '',
        '## Journal trail',
        '',
        '- 2026-09-18 — opened',
      ],
    ),
    // The v0.8 shape of a backlog item: one `<slug>.item.md` file each, in a grouping folder.
    'memory/status/backlog/ideas/ideas.index.md': doc(
      'index',
      'Ideas',
      '../backlog.index.md',
      [],
      ['- [richer-history.item.md](./richer-history.item.md)'],
    ),
    'memory/status/backlog/ideas/richer-history.item.md': doc(
      'backlog-item',
      'Richer history in the browser tab',
      './ideas.index.md',
      [],
      ['Keep more of the history and search it.'],
    ),
    'memory/status/backlog/upgrade-findings.backlog.md': doc(
      'backlog',
      'Findings from the last upgrade',
      './backlog.index.md',
      [],
      ['1. A finding.', '2. Another finding.'],
    ),

    // ----- journal -----
    'memory/journal/journal.index.md': doc(
      'index',
      'Journal',
      '../memory.index.md',
      [],
      ['- [live/](./live/live.index.md)', '- [archive/](./archive/archive.index.md)'],
    ),
    'memory/journal/live/live.index.md': doc(
      'index',
      'Journal — live',
      '../journal.index.md',
      [],
      ['- [2026-09-16_01.md](./2026-09-16_01.md)', '- [2026-09-18_01.md](./2026-09-18_01.md)'],
    ),
    'memory/journal/live/2026-09-16_01.md': doc(
      'journal',
      'The second stage started',
      './live.index.md',
      ['date: 2026-09-16', 'session: 01', 'track: home'],
      ['## What happened', '', 'The second stage was started.'],
    ),
    'memory/journal/live/2026-09-18_01.md': doc(
      'journal',
      'The first step of the second stage',
      './live.index.md',
      ['date: 2026-09-18', 'session: 01', 'track: home'],
      [
        '## What happened',
        '',
        'The first step was half built.',
        '',
        '## Dead ends and lessons',
        '',
        'One approach was dropped.',
        '',
        '## Handover',
        '',
        'Next: finish the first step of the second stage. The draft of the product document is current.',
      ],
    ),
    'memory/journal/archive/archive.index.md': doc(
      'index',
      'Journal — archive',
      '../journal.index.md',
      [],
      ['- [2026-06-01_01.md](./2026-06-01_01.md)'],
    ),
    'memory/journal/archive/2026-06-01_01.md': doc(
      'journal',
      'An old session',
      './archive.index.md',
      ['date: 2026-06-01', 'session: 01', 'track: home'],
      [
        '## What happened',
        '',
        'Earlier work was finished.',
        '',
        '## Handover',
        '',
        'Nothing open.',
      ],
    ),

    // ----- blueprint -----
    'memory/blueprint/blueprint.index.md': doc(
      'index',
      'Blueprint',
      '../memory.index.md',
      [],
      [
        '- [contracts/](./contracts/contracts.index.md)',
        '- [mirror/](./mirror/mirror.index.md)',
        '- [processes/](./processes/processes.index.md)',
        '- [tooling/](./tooling/tooling.index.md)',
        '- [verbs/](./verbs/verbs.index.md)',
      ],
    ),
    'memory/blueprint/contracts/contracts.index.md': doc(
      'index',
      'Contracts',
      '../blueprint.index.md',
      [],
      [
        '- [typescript-everywhere.contract.md](./typescript-everywhere.contract.md)',
        '- [core-has-no-electron.contract.md](./core-has-no-electron.contract.md)',
        '- [contracts.spec.md](./contracts.spec.md)',
        '- [core/](./core/core.index.md)',
      ],
    ),
    // Several contracts in one file, one per `##` section, as older projects wrote them.
    'memory/blueprint/contracts/contracts.spec.md': doc(
      'blueprint',
      'Production contracts',
      './contracts.index.md',
      ['branch: contracts'],
      [
        'Standing contracts the Payload must honour across all work.',
        '',
        ...CONTRACT_SPEC_SECTIONS.flatMap(([title, rule]) => [`## ${title}`, '', rule, '']),
      ],
    ),
    'memory/blueprint/contracts/typescript-everywhere.contract.md': doc(
      'blueprint',
      'TypeScript everywhere',
      './contracts.index.md',
      ['branch: contracts'],
      ['## The contract', '', 'Every source file of the payload is TypeScript.'],
    ),
    'memory/blueprint/contracts/core-has-no-electron.contract.md': doc(
      'blueprint',
      'Core has no Electron import',
      './contracts.index.md',
      ['branch: contracts'],
      ['## The contract', '', 'The core package never imports electron.'],
    ),
    'memory/blueprint/contracts/core/core.index.md': doc(
      'index',
      'Core contracts',
      '../contracts.index.md',
      [],
      [
        '- [golden-rule.contract.md](./golden-rule.contract.md)',
        '- [journal-append-forward.contract.md](./journal-append-forward.contract.md)',
      ],
    ),
    'memory/blueprint/contracts/core/golden-rule.contract.md': doc(
      'blueprint',
      'golden-rule',
      './core.index.md',
      ['branch: contracts'],
      ['Every write is confirmed to a verb.'],
    ),
    'memory/blueprint/contracts/core/journal-append-forward.contract.md': doc(
      'blueprint',
      'journal-append-forward',
      './core.index.md',
      ['branch: contracts'],
      ['A journal entry is never edited after it is written.'],
    ),
    'memory/blueprint/mirror/mirror.index.md': doc(
      'index',
      'Mirror',
      '../blueprint.index.md',
      [],
      ['- [packages/app.mirror.md](./packages/app.mirror.md)'],
    ),
    'memory/blueprint/mirror/packages/app.mirror.md': doc(
      'blueprint',
      'packages/app — the application',
      '../mirror.index.md',
      ['branch: mirror'],
      ['**What it is.** The application of the payload.', '', '**What it owns.** `src/`.'],
    ),
    'memory/blueprint/processes/processes.index.md': doc(
      'index',
      'Processes',
      '../blueprint.index.md',
      [],
      [
        '- [release-check.process.md](./release-check.process.md)',
        '- [core/](./core/core.index.md)',
      ],
    ),
    'memory/blueprint/processes/release-check.process.md': doc(
      'blueprint',
      'release-check',
      './processes.index.md',
      ['branch: processes'],
      ['A process of this project: what is checked before a release.'],
    ),
    'memory/blueprint/processes/core/core.index.md': doc(
      'index',
      'Core processes',
      '../processes.index.md',
      [],
      ['- [close-out.process.md](./close-out.process.md)'],
    ),
    'memory/blueprint/processes/core/close-out.process.md': doc(
      'blueprint',
      'close-out',
      './core.index.md',
      ['branch: processes'],
      ['The finish-line ritual.'],
    ),
    'memory/blueprint/tooling/tooling.index.md': doc(
      'index',
      'Tooling',
      '../blueprint.index.md',
      [],
      ['- [build-script.tooling.md](./build-script.tooling.md)'],
    ),
    'memory/blueprint/tooling/build-script.tooling.md': doc(
      'blueprint',
      'build-script',
      './tooling.index.md',
      ['branch: tooling'],
      ['The card of the build script the project owns.'],
    ),
    'memory/blueprint/verbs/verbs.index.md': doc(
      'index',
      'Verbs',
      '../blueprint.index.md',
      [],
      ['- [core/](./core/core.index.md)'],
    ),
    'memory/blueprint/verbs/core/core.index.md': doc(
      'index',
      'Core verbs',
      '../verbs.index.md',
      [],
      ['- [orient.verb.md](./orient.verb.md)'],
    ),
    'memory/blueprint/verbs/core/orient.verb.md': doc(
      'blueprint',
      'orient',
      './core.index.md',
      ['branch: verbs'],
      ['The session-opening bookend.'],
    ),

    // ----- notepad -----
    'memory/notepad/notepad.index.md': doc(
      'index',
      'Notepad',
      '../memory.index.md',
      [],
      [
        '- [product-document.note.md](./product-document.note.md)',
        '- [product-critique-2026-09-18.note.md](./product-critique-2026-09-18.note.md)',
        '- [renderer-imports.note.md](./renderer-imports.note.md)',
      ],
    ),
    'memory/notepad/product-document.note.md': doc(
      'note',
      'The product document',
      './notepad.index.md',
      [],
      [
        'The draft spec of the in-progress focus.',
        '',
        '![Dashboard](./product-document/Dashboard.png)',
        '![Welcome](./product-document/companion/Welcome.png)',
      ],
    ),
    [ODD_NAME]: Buffer.from('a mind map, which is not markdown\n', 'utf8'),
    [EXECUTABLE]:
      '#!/bin/sh\n# The script that the tooling card registers. The fixture never runs it.\nexit 0\n',
    'memory/notepad/product-document/Dashboard.png': ONE_PIXEL_PNG,
    'memory/notepad/product-document/companion/Welcome.png': ONE_PIXEL_PNG,
    'memory/notepad/product-critique-2026-09-18.note.md': doc(
      'note',
      'Critique of the product document',
      './notepad.index.md',
      [],
      ['An outside critique, with the decisions taken on it.'],
    ),
    'memory/notepad/renderer-imports.note.md': doc(
      'note',
      'Renderer imports',
      './notepad.index.md',
      [],
      ['A note that is not part of the draft spec.'],
    ),

    // ----- save-points, tracks -----
    'memory/save-points/save-points.index.md': doc(
      'index',
      'Save-points',
      '../memory.index.md',
      [],
      [
        '- [2026-07-02_first-release.save-point.md](./2026-07-02_first-release.save-point.md)',
        '- [next.save-point.md](./next.save-point.md)',
      ],
    ),
    'memory/save-points/2026-07-02_first-release.save-point.md': doc(
      'save-point',
      'First release',
      './save-points.index.md',
      ['status: sealed'],
      ['A sealed milestone.'],
    ),
    'memory/save-points/next.save-point.md': doc(
      'save-point',
      'next — open accumulator',
      './save-points.index.md',
      ['status: open'],
      ['The open ledger of acknowledgements.'],
    ),
    'memory/tracks/tracks.index.md': doc(
      'index',
      'Tracks',
      '../memory.index.md',
      [],
      ['- [home.track.md](./home.track.md)'],
    ),
    'memory/tracks/home.track.md': doc(
      'track',
      `${name} — home`,
      './tracks.index.md',
      ['name: home', 'branch: main', `focus: ../status/${inProgress}/${inProgress}.focus.md`],
      ['The always-present track.'],
    ),
  };

  const under = (prefix: string, suffix: string): string[] =>
    Object.keys(files)
      .filter((path) => path.startsWith(prefix) && path.endsWith(suffix))
      .sort();
  const contents: V08FixtureContents = {
    inProgressFocus: `memory/status/${inProgress}/${inProgress}.focus.md`,
    stages: under(`memory/status/${inProgress}/`, '.stage.md'),
    pausedFocuses: [
      'memory/status/port-to-linux/port-to-linux.focus.md',
      'memory/status/side-helper/side-helper.focus.md',
    ],
    doneFocuses: under('memory/status/archive/', '.focus.md'),
    doneFocusFoldersWithoutFile: ['memory/status/archive/first-prototype'],
    backlogFiles: under('memory/status/backlog/', '.backlog.md'),
    backlogItems: under('memory/status/backlog/', '.item.md'),
    // Two sections in parked-work, two list items in upgrade-findings, one item file.
    backlogEntryCount: 5,
    journalEntries: under('memory/journal/live/', '.md').filter(
      (path) => !path.endsWith('.index.md'),
    ),
    projectContracts: under('memory/blueprint/contracts/', '.contract.md').filter(
      (path) => !path.includes('/core/'),
    ),
    contractSpecFiles: ['memory/blueprint/contracts/contracts.spec.md'],
    contractSpecSections: CONTRACT_SPEC_SECTIONS.map(([title]) => title),
    mirrorNodes: under('memory/blueprint/mirror/', '.mirror.md'),
    projectProcesses: under('memory/blueprint/processes/', '.process.md').filter(
      (path) => !path.includes('/core/'),
    ),
    toolingCards: under('memory/blueprint/tooling/', '.tooling.md'),
    productDocument: 'memory/notepad/product-document.note.md',
    productImages: under('memory/notepad/product-document/', '.png'),
    critiqueNote: 'memory/notepad/product-critique-2026-09-18.note.md',
    otherNotes: ['memory/notepad/renderer-imports.note.md'],
    savePoints: under('memory/save-points/', '.save-point.md'),
    tracks: under('memory/tracks/', '.track.md'),
    references: under('references/', '.md'),
    // These four are written by `addUnusualEntries`, after the table.
    ignoredFiles: [...IGNORED_FILES],
    oddNames: [ODD_NAME],
    symlinks: [INSIDE_LINK],
    executableFiles: [EXECUTABLE],
    emptyFolders: [EMPTY_FOLDER],
  };
  return { files, contents };
}

/**
 * What a table of texts cannot hold: the executable bit, a symbolic link, an
 * empty folder, and the files that the ignore rules keep out of the
 * repositories. Written before the Lore's commit, so the link and the bit are
 * in it, and the same on every build.
 */
function addUnusualEntries(lorePath: string, outsideLink: boolean): void {
  const at = (relative: string): string => join(lorePath, ...relative.split('/'));
  chmodSync(at(EXECUTABLE), 0o755);
  symlinkSync(INSIDE_LINK_TARGET, at(INSIDE_LINK));
  if (outsideLink) symlinkSync(OUTSIDE_LINK_TARGET, at(OUTSIDE_LINK));
  mkdirSync(at(EMPTY_FOLDER));
  for (const relative of IGNORED_FILES) {
    mkdirSync(dirname(at(relative)), { recursive: true });
    writeFileSync(at(relative), DS_STORE_BYTES);
  }
}

/** The older tree: the manifest at the top of the Lore folder, and the focus named by `status.index.md`. */
function olderTree(
  name: string,
  coreVersion: string,
): { files: FileTable; contents: V08FixtureContents } {
  const files: FileTable = {
    'workspace.yaml': `project_name: ${name}\ncore_version: "${coreVersion}"\n`,
    'process/verbs/verbs.index.md': '# Verbs\n',
    'memory/.gitignore': '.DS_Store\n',
    'memory/status/status.index.md': [
      '---',
      'type: status',
      `title: ${name} — Status`,
      'updated: 2026-05-26',
      'references: []',
      'active_focus: ./focus/demo.focus.md',
      '---',
      '',
      `# ${name} — Status`,
      '',
    ].join('\n'),
    'memory/status/focus/demo.focus.md': [
      '---',
      'type: focus',
      'title: Demo',
      'updated: 2026-05-26',
      'references: []',
      'status: Active',
      'focus_type: build',
      '---',
      '',
      '# Demo',
      '',
      '[Phase A](../../action-tree/demo/A-phase.phase.md)',
      '',
    ].join('\n'),
    'memory/action-tree/demo/A-phase.phase.md': [
      '---',
      'type: at-node',
      'title: Phase A',
      'updated: 2026-05-26',
      'references: []',
      'status: Active',
      '---',
      '',
      '# Phase A',
      '',
    ].join('\n'),
    'memory/journal/live/2026-05-26_01.md': '# A session\n\n## Handover\n\nNothing open.\n',
    'memory/knowledge-tree/knowledge-tree.index.md': '# Knowledge tree\n',
    'memory/blueprint/contracts/contracts.index.md': '# Contracts\n',
  };
  const contents: V08FixtureContents = {
    inProgressFocus: null,
    stages: [],
    pausedFocuses: [],
    doneFocuses: [],
    doneFocusFoldersWithoutFile: [],
    backlogFiles: [],
    backlogItems: [],
    backlogEntryCount: 0,
    journalEntries: [],
    projectContracts: [],
    contractSpecFiles: [],
    contractSpecSections: [],
    mirrorNodes: [],
    projectProcesses: [],
    toolingCards: [],
    productDocument: null,
    productImages: [],
    critiqueNote: null,
    otherNotes: [],
    savePoints: [],
    tracks: [],
    references: [],
    ignoredFiles: [],
    oddNames: [],
    symlinks: [],
    executableFiles: [],
    emptyFolders: [],
  };
  return { files, contents };
}

/** The payload repository's own files, with the v0.8 Claude binding. */
function payloadFiles(name: string): FileTable {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit|NotebookEdit',
          hooks: [{ type: 'command', command: 'python3 .claude/hooks/ai-lore-guard.py pre' }],
        },
      ],
    },
  };
  return {
    '.gitignore': `# The Lore folder is its own repository\n.ai-lore-${name}/\n/ai_readme.md\nnode_modules/\n`,
    'README.md': `# ${name}\n\nThe payload of the v0.8 fixture.\n`,
    'package.json': `${JSON.stringify({ name, version: '1.0.0', private: true }, null, 2)}\n`,
    'src/index.ts': "export const greeting = 'hello';\n",
    'CLAUDE.md': 'This project uses AI-Lore. Read `ai_readme.md` and follow its instructions.\n',
    'ai_readme.md': `# ${name}\n\nThis project uses AI-Lore. Read \`.ai-lore-${name}/ai_readme.md\`.\n`,
    '.claude/settings.json': `${JSON.stringify(settings, null, 2)}\n`,
    '.claude/hooks/ai-lore-guard.py':
      '# The guard hook of the v0.8 binding. The fixture never runs it.\n',
    '.claude/skills/ai-lore-orient/SKILL.md':
      '---\nname: ai-lore-orient\n---\n\nThe verb orient.\n',
  };
}

function writeTable(repo: TempGitRepo, prefix: string, files: FileTable): void {
  for (const [path, content] of Object.entries(files)) {
    const relative = prefix === '' ? path : `${prefix}/${path}`;
    if (typeof content === 'string') {
      repo.write(relative, content);
    } else {
      // `write` creates the folders; the bytes then replace the empty text.
      repo.write(relative, '');
      writeFileSync(join(repo.dir, ...relative.split('/')), content);
    }
  }
}

function listFiles(dir: string, relative = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFiles(join(dir, entry.name), path));
    else found.push(path);
  }
  return found.sort();
}

async function pushToNewRemote(repo: TempGitRepo, remoteDir: string): Promise<TempGitRepo> {
  const remote = await makeTempGitRepo({ dir: remoteDir, bare: true });
  unwrap(await git.addRemote(repo.dir, 'origin', remote.dir));
  unwrap(await git.push(repo.dir, { setUpstream: true }));
  return remote;
}

/**
 * Build the v0.8 fixture, or its older variant. Both repositories have one
 * commit, pushed to their bare remotes, and a clean working tree unless
 * `uncommitted` is set.
 */
export async function makeV08Fixture(options: V08FixtureOptions = {}): Promise<V08Fixture> {
  const temp = makeTempDir('ai-lore-v08-');
  try {
    const name = options.name ?? 'fixture-project';
    const coreVersion = options.coreVersion ?? '0.8';
    const shape = /^0\.8(\.[0-9]+)*$/.test(coreVersion) ? 'v0.8' : 'older';
    const root = join(temp.dir, name);
    const loreName = `.ai-lore-${name}`;
    const lorePath = join(root, loreName);
    const memoryPath = join(lorePath, 'memory');
    const tree = shape === 'v0.8' ? v08Tree(name, coreVersion) : olderTree(name, coreVersion);

    const payload = await makeTempGitRepo({ dir: root });
    writeTable(payload, '', payloadFiles(name));
    writeTable(payload, loreName, tree.files);
    if (shape === 'v0.8') {
      addUnusualEntries(lorePath, options.outsideLink === true);
      if (options.outsideLink === true) tree.contents.symlinks.push(OUTSIDE_LINK);
    }
    const payloadHead = await payload.commitAll('The payload of the fixture', {
      date: COMMIT_DATE,
    });
    const payloadRemote = await pushToNewRemote(payload, join(temp.dir, 'remotes', 'payload.git'));

    const memory = await makeTempGitRepo({ dir: memoryPath });
    const memoryHead = await memory.commitAll('The Lore of the fixture', { date: COMMIT_DATE });
    const memoryRemote = await pushToNewRemote(memory, join(temp.dir, 'remotes', 'memory.git'));

    const uncommitted: V08Fixture['uncommitted'] = { payload: [], memory: [] };
    if (options.uncommitted === true) {
      payload.write('README.md', `# ${name}\n\nChanged and not committed.\n`);
      payload.write('scratch.txt', 'A new file that is not committed.\n');
      uncommitted.payload = [
        { status: 'added', path: 'scratch.txt' },
        { status: 'changed', path: 'README.md' },
      ];
      memory.write('.gitignore', '.DS_Store\n# changed and not committed\n');
      memory.write('uncommitted-idea.note.md', '# An idea that is not committed\n');
      uncommitted.memory = [
        { status: 'added', path: 'uncommitted-idea.note.md' },
        { status: 'changed', path: '.gitignore' },
      ];
    }

    return {
      root,
      projectName: name,
      coreVersion,
      shape,
      manifestLocation: shape === 'v0.8' ? 'memory-folder' : 'lore-folder',
      lorePath,
      memoryPath,
      payload,
      payloadRemote,
      payloadHead,
      memory,
      memoryRemote,
      memoryHead,
      contents: tree.contents,
      loreFiles: listFiles(lorePath),
      uncommitted,
      cleanup: temp.cleanup,
    };
  } catch (caught) {
    temp.cleanup();
    throw caught;
  }
}
