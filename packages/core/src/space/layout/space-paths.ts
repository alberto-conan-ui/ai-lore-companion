/**
 * The paths of a Space. The folder layout is fixed by the product document;
 * this is the one place that spells it out.
 */

import { join, resolve } from 'node:path';

/** The absolute paths of a Space's fixed folders and files. */
export type SpacePaths = {
  /** `<space>/` */
  root: string;
  /** `<space>/ai_readme.md` */
  aiReadme: string;
  /** `<space>/lore/` */
  lore: string;
  /** `<space>/lore/space.md`, the Space's manifest card. */
  manifest: string;
  /** `<space>/publish/`, the default publish area. */
  publish: string;
  /** `<space>/repos/`, git-ignored. */
  repos: string;
  /** `<space>/workbench/`, git-ignored. */
  workbench: string;
  /** `<space>/workbench/drafts/` */
  drafts: string;
  /** `<space>/workbench/journal/` */
  journal: string;
  /** `<space>/workbench/scratch/` */
  scratch: string;
};

/** The names of a Space's fixed entries, relative to the Space folder, with `/`. */
export const SPACE_LAYOUT = {
  aiReadme: 'ai_readme.md',
  lore: 'lore',
  manifest: 'lore/space.md',
  publish: 'publish',
  repos: 'repos',
  workbench: 'workbench',
  drafts: 'workbench/drafts',
  journal: 'workbench/journal',
  scratch: 'workbench/scratch',
} as const;

/** The paths of the Space whose folder is `root`. Nothing is read from disk. */
export function spacePaths(root: string): SpacePaths {
  const base = resolve(root);
  const at = (relative: string): string => join(base, ...relative.split('/'));
  return {
    root: base,
    aiReadme: at(SPACE_LAYOUT.aiReadme),
    lore: at(SPACE_LAYOUT.lore),
    manifest: at(SPACE_LAYOUT.manifest),
    publish: at(SPACE_LAYOUT.publish),
    repos: at(SPACE_LAYOUT.repos),
    workbench: at(SPACE_LAYOUT.workbench),
    drafts: at(SPACE_LAYOUT.drafts),
    journal: at(SPACE_LAYOUT.journal),
    scratch: at(SPACE_LAYOUT.scratch),
  };
}
