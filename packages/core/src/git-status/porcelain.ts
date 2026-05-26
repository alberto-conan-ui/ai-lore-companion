/**
 * `git status --porcelain` parser. The porcelain v1 format is the stable
 * machine-friendly output git emits when called with `-z` — NUL-separated
 * entries, each carrying:
 *
 *   `XY ` `<path>` `\0`              (single-path entries)
 *   `RXY ` `<new>` `\0` `<old>` `\0` (renames + copies — two paths)
 *
 * `X` is the index status, `Y` is the working-tree status. The `R`/`C`
 * prefix marks renames and copies, which carry the *old* path after the
 * new path. AI-Lore's drift surface needs only the new path; we keep the
 * old path on the entry for tools that want it but never show it.
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

/**
 * One parsed porcelain entry. `code` is the two-character status, `path` is
 * the file path relative to the repo working-tree root, `oldPath` (renames /
 * copies only) is the source path.
 */
export type PorcelainEntry = {
  /** Two characters: `XY` from the porcelain output. */
  code: string;
  /** New path, repo-relative. */
  path: string;
  /** Source path for renames/copies, repo-relative. */
  oldPath?: string;
};

/**
 * Parse the NUL-separated output of `git status --porcelain -z`. The trailing
 * NUL is tolerated; an empty input returns an empty list. Malformed entries
 * are skipped silently — porcelain is stable, but defensive parsing never
 * fails the entire status read.
 */
export function parsePorcelainZ(text: string): PorcelainEntry[] {
  if (text.length === 0) return [];
  const parts = text.split('\0');
  const out: PorcelainEntry[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || part.length < 4) continue;
    const code = part.slice(0, 2);
    const path = part.slice(3);
    const flag = code[0];
    if (flag === 'R' || flag === 'C') {
      // Renames + copies carry the *source* path in the next NUL field.
      const oldPath = parts[i + 1] ?? '';
      i += 1;
      out.push({ code, path, oldPath });
    } else {
      out.push({ code, path });
    }
  }
  return out;
}

/** Whether a porcelain code marks the file as added (untracked or staged add). */
export function isAdded(code: string): boolean {
  return code[0] === 'A' || code === '??';
}

/** Whether a porcelain code marks the file as deleted. */
export function isDeleted(code: string): boolean {
  return code[0] === 'D' || code[1] === 'D';
}

/** Whether a porcelain code marks a rename or copy. */
export function isRenamed(code: string): boolean {
  return code[0] === 'R' || code[0] === 'C';
}
