/**
 * Where everything of a v0.8 project goes in the new Space, and the issues it
 * becomes. Computed from the reader's description and the settings, without
 * reading the disk, so the plan, the steps' `describe` and `isDone`, and their
 * `run` all use the same destinations.
 */

import { posix } from 'node:path';
import { formatIssueMarker } from '../github/marker.js';
import { PAUSED_LABEL } from '../github/types.js';
import { SPACE_LAYOUT } from '../layout/space-paths.js';
import type { V08Description, V08File, V08Focus } from '../legacy/v08-types.js';
import { corpusEntryFileName } from '../setup/lore-writes.js';
import type { MigrationSettings } from './context.js';
import type { MigrationIssuePlan } from './types.js';

/** The name of the markers of migrated issues: `<!-- ai-lore-migrated: <key> -->`. */
export const MIGRATED_MARKER_NAME = 'migrated';

/** The folder the v0.8 `memory/` and `references/` are copied into, Space-relative. */
export const ARCHIVE_DIR = `${SPACE_LAYOUT.publish}/archive/v0.8`;

/** The file that points to the old folder and the two old repositories (section 10.1, question 9). */
export const ARCHIVE_POINTER = `${SPACE_LAYOUT.publish}/archive/index.md`;

/** One file the archive copy takes. */
export type ArchivedFile = {
  /** Source-relative. */
  from: string;
  /** Space-relative, under `ARCHIVE_DIR`. */
  to: string;
  size: number;
  /** The SHA-256 the reader computed, or `null` when it could not read the file. */
  sha256: string | null;
  /** For a symbolic link that points inside its folder, its target as written; else `null`. */
  linkTarget: string | null;
};

/** One project contract and its card (section 10.1, question 16: one card per source file). */
export type ContractCard = {
  /** Source-relative. */
  from: string;
  /** Space-relative: `lore/contracts/<name>.md`. */
  to: string;
  /** The card's `name`. */
  name: string;
};

/** One file that goes to `workbench/drafts/`. */
export type DraftFile = {
  from: string;
  to: string;
  role: 'product-document' | 'product-image' | 'critique-note';
  sha256: string | null;
};

/** Every destination of a migration, Space-relative. */
export type MigrationTargets = {
  archiveDir: string;
  pointer: string;
  /** The files the archive copy takes: those under `memory/` and `references/`, links that point inside included. */
  archived: ArchivedFile[];
  /** Links under `memory/` or `references/` that point outside, at a folder or at nothing: not copied. */
  refusedLinks: string[];
  contracts: ContractCard[];
  /** The mirror of the payload repository, which receives the v0.8 mirror's prose. */
  mirror: { from: string[]; to: string };
  /** The first journal entry, or `null` when no journal entry has a handover. */
  handover: { from: string; heading: string; to: string } | null;
  drafts: DraftFile[];
  corpusEntry: string;
  /** The payload repository's checkout, `repos/<name>`. */
  payloadCheckout: string;
};

/** The Lore-folder part of a source-relative path removed: `memory/…` or `references/…`. */
export function loreRelative(source: V08Description, path: string): string {
  const prefix = `${source.loreFolder}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Where a source-relative file or folder of the Lore is in the archive, Space-relative. */
export function archivedPath(source: V08Description, path: string): string {
  return `${ARCHIVE_DIR}/${loreRelative(source, path)}`;
}

function isCopied(file: V08File): boolean {
  return file.archived && (file.link === null || file.link.standing === 'inside');
}

/** The card name of a contract file: its name without `.contract.md`, `.spec.md` or `.md`. */
export function contractCardName(path: string): string {
  const base = posix.basename(path);
  for (const suffix of ['.contract.md', '.spec.md', '.md']) {
    if (base.endsWith(suffix)) return base.slice(0, -suffix.length);
  }
  return base;
}

/**
 * The id that ends the name of the journal entry the migration writes. The
 * entry is written by the migration, not by a session, and no session has this
 * id, so under the contract journal-append-forward the entry is written once
 * and no session changes it afterwards.
 */
export const MIGRATION_JOURNAL_ID = 'migration';

/**
 * The name of the first journal entry, in the form the contract
 * journal-append-forward and the corpus entry "journal" give: the date of the
 * v0.8 entry the handover came from, `0000` for the time, the words
 * `v08-handover`, and the id `MIGRATION_JOURNAL_ID`, with hyphens between them.
 */
export function handoverEntryName(date: string | null): string {
  return `${date ?? 'undated'}-0000-v08-handover-${MIGRATION_JOURNAL_ID}.md`;
}

function draftTarget(anchorDir: string, path: string): string {
  const relative = path.startsWith(`${anchorDir}/`)
    ? path.slice(anchorDir.length + 1)
    : posix.basename(path);
  return `${SPACE_LAYOUT.drafts}/${relative}`;
}

/** Every destination of the migration of `source` with `settings`. Reads nothing. */
export function migrationTargets(
  source: V08Description,
  settings: Pick<MigrationSettings, 'name' | 'payloadGitHub'>,
): MigrationTargets {
  const hashOf = new Map(source.files.map((file) => [file.path, file.sha256]));
  const archived = source.files.filter(isCopied).map((file) => ({
    from: file.path,
    to: archivedPath(source, file.path),
    size: file.size,
    sha256: file.sha256,
    linkTarget: file.link?.target ?? null,
  }));
  const refusedLinks = source.files
    .filter((file) => file.archived && file.link !== null && file.link.standing !== 'inside')
    .map((file) => file.path);

  const contracts = source.contracts.map((contract) => {
    const name = contractCardName(contract.path);
    return { from: contract.path, to: `${SPACE_LAYOUT.lore}/contracts/${name}.md`, name };
  });

  const payloadName = posix.basename(settings.payloadGitHub);
  const mirror = {
    from: source.mirror.map((node) => node.path),
    to: `${SPACE_LAYOUT.lore}/mirrors/${payloadName}.md`,
  };

  const found = source.journal.newestHandover;
  const handover =
    found === null
      ? null
      : {
          from: found.path,
          heading: found.heading,
          to: `${SPACE_LAYOUT.journal}/${handoverEntryName(
            source.journal.entries.find((entry) => entry.path === found.path)?.date ?? null,
          )}`,
        };

  const { productDocument, productImages, critiqueNote } = source.notepad;
  const anchor = productDocument === null ? '' : posix.dirname(productDocument);
  const drafts: DraftFile[] = [];
  const draft = (path: string, role: DraftFile['role']): void => {
    drafts.push({
      from: path,
      to: draftTarget(anchor, path),
      role,
      sha256: hashOf.get(path) ?? null,
    });
  };
  if (productDocument !== null) draft(productDocument, 'product-document');
  for (const image of productImages) draft(image, 'product-image');
  if (critiqueNote !== null) draft(critiqueNote, 'critique-note');

  return {
    archiveDir: ARCHIVE_DIR,
    pointer: ARCHIVE_POINTER,
    archived,
    refusedLinks,
    contracts,
    mirror,
    handover,
    drafts,
    corpusEntry: `${SPACE_LAYOUT.lore}/corpus/${corpusEntryFileName(settings.name)}`,
    payloadCheckout: `${SPACE_LAYOUT.repos}/${payloadName}`,
  };
}

/** The focuses `readV08Project` found in progress, in the registry's order. */
export function inProgressFocuses(source: V08Description): V08Focus[] {
  return source.focuses.filter((focus) => focus.status === 'in progress');
}

/** The paused focuses, in the registry's order. */
export function pausedFocuses(source: V08Description): V08Focus[] {
  return source.focuses.filter((focus) => focus.status === 'paused');
}

function focusKey(focus: V08Focus): string {
  return focus.bodyPath ?? focus.folderPath ?? focus.name;
}

function titleOf(title: string | null, path: string): string {
  return title ?? posix.basename(path).replace(/\.md$/, '');
}

function issue(
  source: V08Description,
  plan: Omit<MigrationIssuePlan, 'marker' | 'archived'> & { archivedFrom: string },
): MigrationIssuePlan {
  const { archivedFrom, ...rest } = plan;
  return {
    ...rest,
    marker: formatIssueMarker(MIGRATED_MARKER_NAME, plan.key),
    archived: archivedPath(source, archivedFrom),
  };
}

/**
 * The issues of step 11, in the order they are created: each in-progress
 * focus as a focus issue at `focusStage`, followed by one sub-issue per stage;
 * each paused focus as one issue labelled `paused`; one issue per backlog file
 * (section 10.1, question 6). Each is keyed by the source-relative path it
 * stands for.
 */
export function migrationIssues(
  source: V08Description,
  settings: Pick<MigrationSettings, 'focusStage'>,
): MigrationIssuePlan[] {
  const issues: MigrationIssuePlan[] = [];
  for (const focus of inProgressFocuses(source)) {
    const key = focusKey(focus);
    issues.push(
      issue(source, {
        kind: 'focus',
        title: focus.title ?? focus.name,
        labels: [],
        key,
        archivedFrom: focus.folderPath ?? key,
        parentKey: null,
        stage: settings.focusStage,
      }),
    );
    for (const stage of focus.stages) {
      issues.push(
        issue(source, {
          kind: 'stage',
          title: titleOf(stage.title, stage.path),
          labels: [],
          key: stage.path,
          archivedFrom: stage.path,
          parentKey: key,
          stage: null,
        }),
      );
    }
  }
  for (const focus of pausedFocuses(source)) {
    const key = focusKey(focus);
    issues.push(
      issue(source, {
        kind: 'paused-focus',
        title: focus.title ?? focus.name,
        labels: [PAUSED_LABEL],
        key,
        archivedFrom: focus.folderPath ?? key,
        parentKey: null,
        stage: null,
      }),
    );
  }
  for (const file of source.backlog) {
    issues.push(
      issue(source, {
        kind: 'backlog',
        title: titleOf(file.title, file.path),
        labels: [],
        key: file.path,
        archivedFrom: file.path,
        parentKey: null,
        stage: null,
      }),
    );
  }
  return issues;
}
