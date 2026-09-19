/**
 * The skills an engine adapter can offer a session (phase M10.5): read from
 * the install's own record (`install.json`), not from the Lore directly, so
 * that what a session is told matches what was actually installed.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  claudeCodeInstallPaths,
  parseLoreFrontmatter,
  readInstallRecord,
} from '@ai-lore-companion/core';

/** One installed skill: a verb or a process of the Lore, as the install wrote it. */
export type InstalledSkill = {
  /** The skill's folder name. */
  name: string;
  /** From the SKILL.md frontmatter. */
  description: string;
  /** Absolute path of the card in the Space. */
  cardPath: string;
  /** Absolute path of the SKILL.md in the install. */
  skillFile: string;
  /** The SKILL.md as written. */
  text: string;
};

/** The skill's folder name from its path in the install record (`.../skills/<name>/SKILL.md`). */
function skillNameOf(recordPath: string): string {
  const parts = recordPath.split('/');
  return parts[parts.length - 2] ?? '';
}

/**
 * The skills of the install, sorted by name. Reads `install.json` and each
 * skill file. A skill file that cannot be read or has no description is left
 * out.
 */
export async function readInstalledSkills(
  installDir: string,
  spaceRoot: string,
): Promise<InstalledSkill[]> {
  const paths = claudeCodeInstallPaths(installDir);
  const record = await readInstallRecord(paths.dir);
  if (!record.ok || record.value === null) return [];
  const skills: InstalledSkill[] = [];
  for (const file of record.value.files) {
    if (file.kind !== 'skill') continue;
    const skillFile = join(paths.dir, ...file.path.split('/'));
    let text: string;
    try {
      text = await readFile(skillFile, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseLoreFrontmatter(text);
    if (!parsed.ok) continue;
    const description = parsed.value.data.description;
    if (typeof description !== 'string' || description === '') continue;
    const firstCard = file.cards[0];
    if (firstCard === undefined) continue;
    const cardPath = join(spaceRoot, ...firstCard.path.split('/'));
    skills.push({ name: skillNameOf(file.path), description, cardPath, skillFile, text });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
