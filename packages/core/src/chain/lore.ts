import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LORE_PREFIX = '.ai-lore-';
const PROJECT_NAME_LINE = /^project_name\s*:\s*"?([A-Za-z0-9_][A-Za-z0-9_-]*)"?\s*$/m;

export type LoreLocation = {
  lorePath: string;
  projectName: string;
};

export function locateLore(root: string): LoreLocation | { error: string } {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    return { error: `cannot read project root: ${(err as Error).message}` };
  }

  const candidates = entries.filter((name) => name.startsWith(LORE_PREFIX));
  if (candidates.length === 0) {
    return { error: `no .ai-lore-* folder under ${root}` };
  }
  if (candidates.length > 1) {
    return { error: `multiple .ai-lore-* folders under ${root}: ${candidates.join(', ')}` };
  }

  const loreName = candidates[0];
  if (!loreName) return { error: 'lore folder name empty' };

  const lorePath = join(root, loreName);
  if (!statSync(lorePath).isDirectory()) {
    return { error: `${loreName} is not a directory` };
  }

  const manifestPath = join(lorePath, 'workspace.yaml');
  if (!existsSync(manifestPath)) {
    return { error: `workspace.yaml missing under ${loreName}` };
  }

  const manifest = readFileSync(manifestPath, 'utf8');
  const match = manifest.match(PROJECT_NAME_LINE);
  const projectName = match?.[1]?.trim();
  if (!projectName) {
    return { error: 'workspace.yaml has no project_name' };
  }

  const expected = `${LORE_PREFIX}${projectName}`;
  if (loreName !== expected) {
    return {
      error: `lore folder name '${loreName}' does not match project_name '${projectName}' (expected '${expected}')`,
    };
  }

  return { lorePath, projectName };
}
