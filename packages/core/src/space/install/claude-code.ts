/**
 * The projection of a resolved Lore into Claude Code, as a pure function: from
 * what `readLore` returned to the list of files of the install folder. Nothing
 * here reads or writes a file; `writer.ts` does.
 *
 * What is projected (architecture document, section 5.5):
 *
 *   plugin/.claude-plugin/plugin.json      the plugin, named `lore`
 *   plugin/skills/<name>/SKILL.md          one per verb and per process in use
 *   checks/<script file name>              one per check script a contract in use names
 *
 * The projection holds no hook. A hook command carries a session's id, so the
 * hooks are generated when a session starts, by the app.
 */

import { basename, join } from 'node:path';
import { isInsideLexically, toPosixRelative } from '../fs/index.js';
import type {
  ContractCard,
  LoreEntry,
  ProcessCard,
  ResolvedLore,
  VerbCard,
} from '../lore/types.js';
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  checkSkillName,
  renderSkillFile,
  safeSkillDescription,
} from './skill.js';
import type {
  ClaudeCodeInstallPaths,
  ClaudeCodeProjection,
  InstallReport,
  InstalledCardRef,
  ProjectedFile,
} from './types.js';

/** The plugin's name. Claude Code shows each skill as `/lore:<name>`. */
export const CLAUDE_CODE_PLUGIN_PREFIX = 'lore';

/** The folder of the Claude Code install inside a desk's install folder. */
export const CLAUDE_CODE_INSTALL_FOLDER = 'claude-code';

/** The paths of the projection relative to the install folder, with `/`. */
export const CLAUDE_CODE_INSTALL_LAYOUT = {
  plugin: 'plugin',
  pluginManifest: 'plugin/.claude-plugin/plugin.json',
  skills: 'plugin/skills',
  skillFile: 'SKILL.md',
  checks: 'checks',
  record: 'install.json',
} as const;

/** The file name of a check script in the checks folder. */
const CHECK_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The reader's problem kinds that mean a card was not used. */
const CARD_NOT_USED = ['frontmatter', 'card', 'core-name-taken', 'unreadable', 'symlink'];

/**
 * The absolute paths of the Claude Code install under `installDir`, which is
 * the `install` folder of a desk (`DeskPaths.install`).
 */
export function claudeCodeInstallPaths(installDir: string): ClaudeCodeInstallPaths {
  const dir = join(installDir, CLAUDE_CODE_INSTALL_FOLDER);
  return {
    dir,
    plugin: join(dir, 'plugin'),
    pluginManifest: join(dir, 'plugin', '.claude-plugin', 'plugin.json'),
    skills: join(dir, 'plugin', 'skills'),
    checks: join(dir, 'checks'),
    record: join(dir, CLAUDE_CODE_INSTALL_LAYOUT.record),
  };
}

/** The path, relative to the install folder, of the `SKILL.md` of the skill `name`. */
export function claudeCodeSkillPath(name: string): string {
  return `${CLAUDE_CODE_INSTALL_LAYOUT.skills}/${name}/${CLAUDE_CODE_INSTALL_LAYOUT.skillFile}`;
}

/**
 * The path, relative to the install folder, of the copy of the check script at
 * `scriptPath`: `checks/` and the script's file name. The session files of the
 * app name the copies through this function.
 */
export function claudeCodeCheckPath(scriptPath: string): string {
  return `${CLAUDE_CODE_INSTALL_LAYOUT.checks}/${basename(scriptPath)}`;
}

function cardRef(
  lore: ResolvedLore,
  entry: LoreEntry<VerbCard | ProcessCard | ContractCard>,
): InstalledCardRef {
  return {
    part: entry.part as InstalledCardRef['part'],
    name: entry.name,
    layer: entry.layer,
    path: toPosixRelative(lore.spaceRoot, entry.path),
    replacesDefault: entry.replacesDefault,
    when: entry.card.kind === 'contract' ? entry.card.when : null,
  };
}

function pluginManifestText(): string {
  const manifest = {
    name: CLAUDE_CODE_PLUGIN_PREFIX,
    description:
      "The verbs and processes of this Space's Lore, installed by the AI-Lore companion.",
    version: '1.0.0',
    // Claude Code's validator warns about a manifest without an author.
    author: { name: 'AI-Lore companion' },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The verbs and processes that get a skill, after the rule for a name that a verb and a process share. */
function skillEntries(
  lore: ResolvedLore,
  reports: InstallReport[],
): LoreEntry<VerbCard | ProcessCard>[] {
  const all: LoreEntry<VerbCard | ProcessCard>[] = [...lore.parts.verbs, ...lore.parts.processes];
  const byName = new Map<string, LoreEntry<VerbCard | ProcessCard>[]>();
  for (const entry of all) byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);

  const kept: LoreEntry<VerbCard | ProcessCard>[] = [];
  for (const [name, entries] of byName) {
    if (entries.length === 1) {
      kept.push(...entries);
      continue;
    }
    const core = entries.filter((entry) => entry.layer === 'core');
    const winner = core.length === 1 ? core[0] : undefined;
    for (const entry of entries) {
      if (entry === winner) {
        kept.push(entry);
        continue;
      }
      const others = entries
        .filter((other) => other !== entry)
        .map((other) => toPosixRelative(lore.spaceRoot, other.path))
        .join(', ');
      const outcome =
        winner === undefined
          ? 'no skill was installed for either'
          : 'the core card was installed and this one was not';
      reports.push({
        kind: 'name-collision',
        path: entry.path,
        message: `the name ${name} is also the name of ${others}, and one skill name stands for one card; ${outcome}`,
      });
    }
  }
  return kept;
}

function projectSkill(
  lore: ResolvedLore,
  entry: LoreEntry<VerbCard | ProcessCard>,
  reports: InstallReport[],
): ProjectedFile | null {
  const what = entry.card.kind;
  const name = checkSkillName(entry.name);
  if (!name.ok) {
    reports.push({
      kind: 'unsafe-name',
      path: entry.path,
      message: `${name.error.message}; no skill was installed for this ${what}`,
    });
    return null;
  }
  if (entry.description === null) {
    reports.push({
      kind: 'no-description',
      path: entry.path,
      message: `the ${what} ${entry.name} has no line in the index of its folder, and the line's sentence is the skill's description; no skill was installed for it`,
    });
    return null;
  }
  const description = safeSkillDescription(entry.description);
  if (!description.ok) {
    reports.push({
      kind: 'no-description',
      path: entry.path,
      message: `the sentence of the ${what} ${entry.name} in the index of its folder is empty; no skill was installed for it`,
    });
    return null;
  }
  if (description.value.changed) {
    reports.push({
      kind: 'description-changed',
      path: entry.path,
      message: `the description of the ${what} ${entry.name} was changed to fit Claude Code's frontmatter: it is on one line, has no control character and no angle bracket, and has at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
    });
  }
  const ref = cardRef(lore, entry);
  const text = renderSkillFile({
    name: name.value,
    description: description.value.text,
    cardKind: what,
    cardPath: entry.path,
    cardRelativePath: ref.path,
  });
  if (!text.ok) {
    reports.push({
      kind: 'frontmatter-unsafe',
      path: entry.path,
      message: `${text.error.message}; no skill was installed for the ${what} ${entry.name}`,
    });
    return null;
  }
  return {
    path: claudeCodeSkillPath(name.value),
    kind: 'skill',
    content: text.value,
    copyFrom: null,
    cards: [ref],
  };
}

function projectChecks(lore: ResolvedLore, reports: InstallReport[]): ProjectedFile[] {
  const byFileName = new Map<string, ProjectedFile>();
  // Core contracts first, so that a script of another layer cannot take the file name of a core check.
  const contracts = [
    ...lore.parts.contracts.filter((entry) => entry.layer === 'core'),
    ...lore.parts.contracts.filter((entry) => entry.layer !== 'core'),
  ];
  for (const entry of contracts) {
    if (entry.card.check === null) continue;
    if (entry.script === null) {
      reports.push({
        kind: 'script-missing',
        path: entry.path,
        message: `the contract ${entry.name} names the check "${entry.card.check}", which is not a file inside the Lore folder; no check was copied for it`,
      });
      continue;
    }
    const fileName = basename(entry.script);
    if (!CHECK_FILE_NAME.test(fileName)) {
      reports.push({
        kind: 'unsafe-check-name',
        path: entry.script,
        message: `the check script of the contract ${entry.name} has a file name that is not letters, digits, dots, underscores and hyphens; it was not copied`,
      });
      continue;
    }
    const ref = cardRef(lore, entry);
    // A filesystem that ignores case holds `Guard.py` and `guard.py` as one file.
    const key = fileName.toLowerCase();
    const existing = byFileName.get(key);
    if (existing === undefined) {
      byFileName.set(key, {
        path: claudeCodeCheckPath(fileName),
        kind: 'check',
        content: null,
        copyFrom: entry.script,
        cards: [ref],
      });
    } else if (existing.copyFrom === entry.script) {
      existing.cards.push(ref);
    } else {
      reports.push({
        kind: 'check-name-collision',
        path: entry.script,
        message: `the check script of the contract ${entry.name} has the file name of ${existing.copyFrom}, and the checks folder holds one file per name; it was not copied`,
      });
    }
  }
  return [...byFileName.values()];
}

/** The reader's problems that mean a card of verbs, processes or contracts was not used. */
function cardProblemReports(lore: ResolvedLore): InstallReport[] {
  const reports: InstallReport[] = [];
  for (const part of ['verbs', 'processes', 'contracts'] as const) {
    const partDir = join(lore.loreDir, part);
    for (const problem of lore.problems) {
      if (!CARD_NOT_USED.includes(problem.kind)) continue;
      if (!problem.path.endsWith('.md') || basename(problem.path) === 'index.md') continue;
      if (!isInsideLexically(partDir, problem.path)) continue;
      reports.push({
        kind: 'card-problem',
        path: problem.path,
        message: `${problem.message}; nothing was installed for it`,
      });
    }
  }
  return reports;
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Project a resolved Lore into Claude Code: the plugin manifest, one skill per
 * verb and per process in use, and one copy per check script that a contract in
 * use names. An own card that replaces a default is the card in use, so its
 * skill points at the own card. A card the reader did not use, a card without a
 * description, a name that cannot be a skill's name, a name that a verb and a
 * process share, and a check script that is missing are reported and give no
 * file. The files are sorted by path.
 */
export function projectClaudeCode(lore: ResolvedLore): ClaudeCodeProjection {
  const reports: InstallReport[] = cardProblemReports(lore);
  const files: ProjectedFile[] = [
    {
      path: CLAUDE_CODE_INSTALL_LAYOUT.pluginManifest,
      kind: 'plugin-manifest',
      content: pluginManifestText(),
      copyFrom: null,
      cards: [],
    },
  ];
  for (const entry of skillEntries(lore, reports)) {
    const file = projectSkill(lore, entry, reports);
    if (file !== null) files.push(file);
  }
  files.push(...projectChecks(lore, reports));
  return { files: files.sort(byPath), reports };
}
