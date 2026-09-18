/**
 * The description of an AI-Lore v0.8 project, as `readV08Project` gives it.
 *
 * Plain data and types only: the migration screen shows this description, so
 * the renderer imports these types, and this file imports nothing that runs.
 * Every `path` is relative to the project's root (the folder the Human Lead
 * opened), with `/`, so a path under the Lore folder begins with
 * `.ai-lore-<name>/`.
 */

import type { LegacyManifestLocation, LegacyVersionStanding } from '../detect/detect-folder.js';
import type { Failure } from '../result.js';

/** The four values of a v0.8 `status`. `other` stands for any other text (`Achieved`, `Active`). */
export type V08Status = 'draft' | 'paused' | 'in progress' | 'done' | 'other';

/** Why a file, a link or a repository could not be read in full. */
export type V08ProblemKind =
  | 'unreadable'
  | 'too-large'
  | 'bad-frontmatter'
  | 'missing'
  | 'outside-link'
  | 'broken-link'
  | 'folder-link'
  | 'nested-repository'
  | 'repository'
  | 'limit-reached';

/** Something that could not be read. `message` is a sentence for the Human Lead. */
export type V08Problem = { path: string; kind: V08ProblemKind; message: string };

/** One of the two source repositories. */
export type V08Repository = {
  /** `.` for the payload repository; `.ai-lore-<name>/memory` for the Lore repository. */
  path: string;
  /** False when the folder is not the top of a git working tree of its own. The other fields are then empty. */
  present: boolean;
  originUrl: string | null;
  /** The checked-out branch, or `null` when `HEAD` is detached or unknown. */
  branch: string | null;
  detached: boolean;
  /** The SHA of `HEAD`, or `null` in a repository with no commit. */
  head: string | null;
  hasUncommittedChanges: boolean;
  /** The output of `git status --porcelain`, as it was printed. */
  statusText: string;
  /** The number of lines of `statusText`. */
  changedCount: number;
};

/** A `references:` row of a v0.8 frontmatter. */
export type V08Reference = { group: string; path: string };

/** A file of the Lore with the fields every v0.8 document carries. */
export type V08Document = {
  path: string;
  /** The frontmatter's `title`, else the first `#` heading, else `null`. */
  title: string | null;
  /** The frontmatter's `updated`, as text. */
  updated: string | null;
  size: number;
};

/** A heading of level two and the text under it. */
export type V08Section = { heading: string; text: string };

/** A contract of the project: one file outside `contracts/core/`. */
export type V08Contract = V08Document & {
  /**
   * The text of the rule. For a file with a `## The contract` section, that
   * section. For any other file, the whole body under the title.
   */
  rule: string;
  ruleSource: 'the-contract-section' | 'whole-body';
  /**
   * True for a file with no `## The contract` section and two or more `##`
   * sections: each section is a contract (`contracts.spec.md`).
   */
  holdsSeveral: boolean;
  /** Every `##` section of the file, in order. */
  sections: V08Section[];
};

/** A node of the v0.8 mirror. */
export type V08MirrorNode = V08Document & {
  /** What the node describes: its path under `mirror/` without `.mirror.md` (`packages/app`). */
  target: string;
  /** The body under the title, without any fenced block that draws a folder tree. */
  prose: string;
};

export type V08Phase = V08Document & { status: V08Status; statusText: string | null };

export type V08Stage = V08Document & {
  /** The stage's folder. */
  folderPath: string;
  status: V08Status;
  statusText: string | null;
  phases: V08Phase[];
};

/** A focus that is not under `status/archive/`. */
export type V08Focus = {
  /** The name of the focus: the link text of its row, or its folder's name. */
  name: string;
  title: string | null;
  /** The status the registry gives; for a focus that has no row, the status of its file. */
  status: V08Status;
  statusText: string | null;
  /** The status the focus file's own frontmatter gives. */
  statusInFile: string | null;
  /** The track named in the registry's Active column, or `null`. */
  activeTrack: string | null;
  /** False for a focus folder under `status/` that `status.stack.md` has no row for. */
  inStack: boolean;
  /** The focus file, or `null` when the row names a file that is not there. */
  bodyPath: string | null;
  /** The focus's folder: the subtree that a paused focus's issue links to. */
  folderPath: string | null;
  references: V08Reference[];
  stages: V08Stage[];
  /** Phase files that are under no stage's folder. */
  loosePhases: V08Phase[];
  /** How many files the folder holds, at any depth. */
  fileCount: number;
};

/** A finished focus under `status/archive/`: a file, a folder, or a file beside a folder of the same name. */
export type V08FinishedFocus = {
  name: string;
  /** The focus file's title; for a folder with no focus file, the title of the folder's index. */
  title: string | null;
  statusText: string | null;
  bodyPath: string | null;
  folderPath: string | null;
  fileCount: number;
};

export type V08BacklogEntry = { title: string; text: string };

/**
 * A file of `status/backlog/`, at any depth: a `*.backlog.md` file that may
 * list several entries, or a `*.item.md` file (`type: backlog-item`), which is
 * one entry.
 */
export type V08BacklogFile = V08Document & {
  /**
   * For an item file, the file itself. Else the `##` sections of the file,
   * without the sections of the card's own structure (`Purpose`, `Journal
   * trail`); when it has none, its list items at the left margin.
   */
  entries: V08BacklogEntry[];
  entriesFrom: 'whole-file' | 'sections' | 'list-items' | 'none';
};

export type V08JournalEntry = V08Document & {
  /** The frontmatter's `date`, else the date in the file's name, as `YYYY-MM-DD`. */
  date: string | null;
  session: string | null;
  track: string | null;
};

export type V08Journal = {
  /** The entries of `journal/live/`, oldest first. */
  entries: V08JournalEntry[];
  newestEntry: string | null;
  /**
   * The Handover section of the newest entry that has one: a `##` heading that
   * begins with the word Handover. `fromNewestEntry` is false when an older
   * entry gave it.
   */
  newestHandover: { path: string; heading: string; text: string; fromNewestEntry: boolean } | null;
  /** How many entries `journal/archive/` holds. They go to the archive only. */
  archivedCount: number;
};

export type V08NoteRole = 'product-document' | 'critique-note' | 'note';

export type V08Note = V08Document & { role: V08NoteRole };

export type V08Notepad = {
  /** Every `*.md` of the notepad that is not an index. */
  notes: V08Note[];
  productDocument: string | null;
  productImages: string[];
  critiqueNote: string | null;
  /** How the three were recognised, in a sentence each, for the plan screen. */
  recognisedBy: { productDocument: string; productImages: string; critiqueNote: string };
};

/** What a file of the Lore folder is, by where it is and how it is named. */
export type V08FileCategory =
  | 'manifest'
  | 'floor'
  | 'index'
  | 'stack'
  | 'focus'
  | 'finished-focus'
  | 'backlog'
  | 'journal-live'
  | 'journal-archive'
  | 'project-contract'
  | 'core-contract'
  | 'mirror'
  | 'project-process'
  | 'core-process'
  | 'project-tooling'
  | 'core-tooling'
  | 'project-verb'
  | 'core-verb'
  | 'product-document'
  | 'product-image'
  | 'critique-note'
  | 'note'
  | 'save-point'
  | 'track'
  | 'reference'
  | 'other';

/** Where a symbolic link points. Only `inside` links are read through. */
export type V08LinkStanding = 'inside' | 'outside' | 'broken' | 'folder';

/** One file or symbolic link under the Lore folder, without any `.git`. */
export type V08File = {
  path: string;
  /** The size in bytes; for a link that points inside, the size of the file it points to; else 0. */
  size: number;
  category: V08FileCategory;
  /** True for a file under `memory/` or `references/`, which the archive copy takes. */
  archived: boolean;
  link: { target: string; standing: V08LinkStanding } | null;
  /** The SHA-256 of the content, when the read was asked for hashes and the file could be read. */
  sha256: string | null;
};

/** What the archive copy of `memory/` and `references/` will take. */
export type V08ArchiveSummary = {
  /** The folders copied, relative to the project's root. */
  roots: string[];
  fileCount: number;
  totalBytes: number;
  linkCount: number;
  /** Links that the copy must refuse: they point outside their folder, at a folder, or at nothing. */
  refusedLinks: string[];
  /** Folders with nothing in them. A copy of files does not carry them. */
  emptyFolders: string[];
};

/** A text that can serve as the Space's description, and the file it was read from. */
export type V08DescriptionCandidate = { path: string; text: string };

/** The whole description. */
export type V08Description = {
  /** The project's root, absolute. */
  root: string;
  /** The Lore folder's name, `.ai-lore-<name>`, which every Lore path begins with. */
  loreFolder: string;
  project: {
    name: string;
    /** The manifest, which holds the name. */
    namePath: string;
    /** The v0.8 manifest has no description; these are texts the plan screen can offer. */
    descriptionCandidates: V08DescriptionCandidate[];
  };
  core: {
    version: string | null;
    standing: LegacyVersionStanding;
    manifestPath: string;
    manifestLocation: LegacyManifestLocation;
  };
  payloadRepository: V08Repository;
  loreRepository: V08Repository;
  contracts: V08Contract[];
  mirror: V08MirrorNode[];
  /** The registry file, or `null` when it is missing. */
  stackPath: string | null;
  focuses: V08Focus[];
  finishedFocuses: V08FinishedFocus[];
  backlog: V08BacklogFile[];
  journal: V08Journal;
  notepad: V08Notepad;
  processes: V08Document[];
  toolingCards: V08Document[];
  /** Verb cards outside `verbs/core/`. No verb is carried; they are listed so the plan can say so. */
  projectVerbs: V08Document[];
  savePoints: V08Document[];
  tracks: V08Document[];
  references: V08Document[];
  /**
   * The files that match none of the kinds above (category `other`): a file
   * of the notepad that is not markdown, `.gitignore`, `.DS_Store`, the
   * editor's folder. Those under `memory/` or `references/` go to the archive
   * only; the others are not carried.
   */
  unmatched: string[];
  /** Every file under the Lore folder. */
  files: V08File[];
  archive: V08ArchiveSummary;
  problems: V08Problem[];
  /** False when the file limit or the time limit stopped the read; `problems` says which. */
  complete: boolean;
};

/** Options of `readV08Project`. Every one has a default in `V08_READ_DEFAULTS`. */
export type V08ReadOptions = {
  /**
   * The product document is the file that a `references:` row of the
   * in-progress focus names under a group beginning with this text.
   */
  productDocumentGroup?: string;
  /** The same for the critique note. */
  critiqueNoteGroup?: string;
  /** Name the product document directly, relative to the project's root. It replaces the focus's row. */
  productDocumentPath?: string;
  /** Name the critique note directly, relative to the project's root. */
  critiqueNotePath?: string;
  /** Extensions of image files, lower case, with the dot. */
  imageExtensions?: readonly string[];
  /** Compute the SHA-256 of every archived file. The content is streamed. */
  hashes?: boolean;
  /** Stop listing after this many files. */
  maxFiles?: number;
  /** Stop reading after this many milliseconds. */
  timeBudgetMs?: number;
  /** A text file larger than this is not read; it is listed with its size and reported. */
  maxTextBytes?: number;
  /** The limit of one git command, in milliseconds. */
  gitTimeoutMs?: number;
};

/** Why there is no description. */
export type V08ReadFailureKind =
  | 'not-a-legacy-project'
  | 'older-than-v0.8'
  | 'newer-than-v0.8'
  | 'unknown-version'
  | 'read-failed';

/** The failure of `readV08Project`, with what detection learned about the project. */
export type V08ReadFailure = Failure<V08ReadFailureKind> & {
  projectName: string | null;
  coreVersion: string | null;
  versionStanding: LegacyVersionStanding | null;
};
