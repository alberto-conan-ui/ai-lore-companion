/**
 * The shapes of the install into Claude Code: what is projected from a Lore,
 * the record of what was written (`install.json`), the plan of one install and
 * what the install reports.
 *
 * This file imports types only, and everything here is plain data, so a plan
 * crosses IPC as it is and the setup and migration screens can show it.
 */

import type { ContractWhen, LoreLayer } from '../lore/types.js';

/** The absolute paths of the Claude Code install of one desk. Nothing is read from disk. */
export type ClaudeCodeInstallPaths = {
  /** `<install>/claude-code/`, the folder every path below is inside. */
  dir: string;
  /** `<dir>/plugin/`, the folder a session is started with (`--plugin-dir`). */
  plugin: string;
  /** `<dir>/plugin/.claude-plugin/plugin.json` */
  pluginManifest: string;
  /** `<dir>/plugin/skills/`, one folder per skill. */
  skills: string;
  /** `<dir>/checks/`, the copies of the contract check scripts. */
  checks: string;
  /** `<dir>/install.json`, the record of what the install wrote. */
  record: string;
};

/** What a projected file is. */
export type InstalledFileKind = 'plugin-manifest' | 'skill' | 'check';

/** The card a projected file comes from. */
export type InstalledCardRef = {
  /** The part of the Lore that holds the card. */
  part: 'verbs' | 'processes' | 'contracts';
  /** The card's name, which is its file name without `.md`. */
  name: string;
  layer: LoreLayer;
  /** The card's path relative to the Space's folder, with `/`. */
  path: string;
  /** True for an own card that is used instead of a default of the same name. */
  replacesDefault: boolean;
  /** For a contract: when its check runs. `null` for a verb and a process. */
  when: ContractWhen | null;
};

/**
 * One file of the projection. A generated file carries its text in `content`.
 * A check script carries `copyFrom`, the absolute path of the script in the
 * Lore; the writer copies its bytes and does not read it as text.
 */
export type ProjectedFile = {
  /** Relative to the install folder (`ClaudeCodeInstallPaths.dir`), with `/`. */
  path: string;
  kind: InstalledFileKind;
  /** The text of a generated file; `null` for a check script. */
  content: string | null;
  /** The absolute path of the script to copy; `null` for a generated file. */
  copyFrom: string | null;
  /** The cards the file comes from. Empty for the plugin manifest. */
  cards: InstalledCardRef[];
};

/** The kinds of thing an install reports. */
export type InstallReportKind =
  /** The Lore reader did not use a card of verbs, processes or contracts. Nothing was installed for it. */
  | 'card-problem'
  /** A verb or a process has no line in the index of its folder, so it has no description. Not installed. */
  | 'no-description'
  /** A card's name cannot be the name of a Claude Code skill. Not installed. */
  | 'unsafe-name'
  /** A verb and a process have the same name. A core card is installed; otherwise neither is. */
  | 'name-collision'
  /** The description was changed to fit Claude Code's frontmatter. The skill is installed. */
  | 'description-changed'
  /** The skill's frontmatter did not read back as it was written. Not installed. */
  | 'frontmatter-unsafe'
  /** A contract names a check script that is not a file inside the Lore. No check was copied for it. */
  | 'script-missing'
  /** A check script's file name cannot be used in the checks folder. Not copied. */
  | 'unsafe-check-name'
  /** Two different check scripts have the same file name. The first was copied. */
  | 'check-name-collision'
  /** A card or a check script could not be read while the install was planned. Not installed. */
  | 'source-unreadable'
  /** A path is outside the install folder. Nothing was written or removed there. */
  | 'outside-target'
  /** A file the install wrote before has other content now. It was left alone unless the caller asked to replace it. */
  | 'edited-by-hand'
  /**
   * Something the install did not write is at a path of the install: a file where a projected file
   * goes, or a folder or a symbolic link at a path of the projection or of `install.json`. It was left alone.
   */
  | 'not-installed-by-companion'
  /** `install.json` could not be read. The install goes on as if nothing had been installed before. */
  | 'install-record-unreadable';

/** Something the Human Lead should know about an install. `message` can be shown as it is. */
export type InstallReport = {
  kind: InstallReportKind;
  /** The absolute path of the card, script or installed file the report is about. */
  path: string;
  message: string;
};

/** What `projectClaudeCode` returns: the files of the projection, sorted by path, and what it reports. */
export type ClaudeCodeProjection = {
  files: ProjectedFile[];
  reports: InstallReport[];
};

/** One file in `install.json`. */
export type InstalledFile = {
  /** Relative to the install folder, with `/`. */
  path: string;
  kind: InstalledFileKind;
  /** The SHA-256 of the file as the install wrote it, in lower-case hexadecimal. */
  sha256: string;
  /** The cards the file comes from, each with the SHA-256 of the card's file. */
  cards: (InstalledCardRef & { sha256: string })[];
};

/** The version of the `install.json` format. */
export const INSTALL_RECORD_VERSION = 1;

/**
 * The content of `install.json`. It has no date, so that installing the same
 * Lore twice gives the same file.
 */
export type InstallRecord = {
  version: typeof INSTALL_RECORD_VERSION;
  engine: 'claude-code';
  /** The plugin's name, which is the prefix of every skill (`/lore:<name>`). */
  prefix: string;
  /** The absolute path of the Space's folder the Lore was read from. */
  space: string;
  /** Sorted by path. */
  files: InstalledFile[];
};

/** What an install does with one file. */
export type InstallActionKind =
  /** The file is written: it is missing, or it is as the install left it and the projection changed. */
  | 'write'
  /** The file on disk already has the projected content. Nothing is written. */
  | 'unchanged'
  /** The install wrote the file before and the projection no longer has it. It is deleted. */
  | 'remove'
  /**
   * The install wrote the file before, the projection no longer has it, and it is already gone
   * or a folder or a symbolic link is in its place. Nothing is deleted; the path is no longer listed.
   */
  | 'forget'
  /** The install wrote the file before and it has other content now. It is left alone. */
  | 'keep-edited'
  /** The install did not write the file that is at this path. It is left alone. */
  | 'keep-foreign';

/** One line of an install plan. */
export type InstallAction = {
  action: InstallActionKind;
  /** Relative to the install folder, with `/`. */
  path: string;
  kind: InstalledFileKind;
  /** True when the file replaces, or the removal deletes, a file edited by hand (`overwriteEdited`). */
  overwritesEdit: boolean;
};

/** Options of `planClaudeCodeInstall` and `installClaudeCode`. */
export type InstallOptions = {
  /** Return the plan and write nothing. Default `false`. */
  dryRun?: boolean;
  /**
   * Replace or remove a file that the install wrote before and that was edited
   * by hand since. Default `false`: the file is left alone and reported. A file
   * the install did not write is never replaced or removed.
   */
  overwriteEdited?: boolean;
};

/** What an install will do, or did. */
export type InstallPlan = {
  paths: ClaudeCodeInstallPaths;
  /** One action per file, sorted by path. */
  actions: InstallAction[];
  /** The record `install.json` holds after the install. */
  record: InstallRecord;
  /** True when `install.json` on disk differs from `record`, so it is written. */
  recordChanges: boolean;
  reports: InstallReport[];
};

/** What `installClaudeCode` returns. */
export type InstallOutcome = {
  plan: InstallPlan;
  /** False for a dry run. */
  applied: boolean;
  /** The paths written, relative to the install folder. `install.json` is among them when it was written. */
  written: string[];
  /** The paths deleted, relative to the install folder. */
  removed: string[];
};

/** The kinds of failure of an install. Everything else is a report. */
export type InstallFailureKind =
  /** The install folder is not usable: it is not a folder, or a path in it cannot be resolved. */
  | 'target-invalid'
  /**
   * `install.json` was written by a later version of the companion. Nothing is written or removed,
   * because this version cannot tell which files that install owns.
   */
  | 'install-record-newer'
  /** A file could not be written, copied or deleted. Files written before the failure stay. */
  | 'write-failed';
