/**
 * Reading an `index.md` of the Lore.
 *
 * Every folder of the Lore has an index with one line per file and per
 * subfolder, in the form `ai_readme.md` states:
 *
 *   - [spec-draft.md](./spec-draft.md): one sentence that says what the file is for.
 *   - [default/](./default/index.md): one sentence that says what the folder holds.
 *
 * The sentence is the only description a card has, so the reader attaches it
 * to the card. Lines inside a fenced code block are examples and are skipped.
 */

import type { LoreIndex, LoreIndexLine } from './types.js';

const INDEX_LINE = /^- \[([^\]]+)\]\(\.\/([^)]+)\): (\S.*)$/;

/** The lines of `text` that are outside fenced code blocks. */
function linesOutsideFences(text: string): string[] {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept;
}

/**
 * Read the lines of an index from the prose of an `index.md` (the text after
 * its frontmatter; the whole text also works, because no frontmatter line
 * begins with `- `). A line that begins with `- ` and is not in the form above
 * is returned in `malformed` with the reason. A line in that form whose link
 * does not go to the entry it names is returned in both lists: the name counts
 * as listed, and the link is reported.
 */
export function parseLoreIndex(body: string): LoreIndex {
  const lines: LoreIndexLine[] = [];
  const malformed: string[] = [];
  for (const line of linesOutsideFences(body)) {
    if (!line.startsWith('- ')) continue;
    const match = INDEX_LINE.exec(line);
    if (!match) {
      malformed.push(`this line does not have the form of an index line: ${line}`);
      continue;
    }
    const label = match[1] ?? '';
    const target = match[2] ?? '';
    const description = (match[3] ?? '').trimEnd();
    if (label.endsWith('/')) {
      if (target !== `${label}index.md`) {
        malformed.push(`the line for the folder ${label} does not link to its index.md: ${line}`);
      }
      lines.push({ name: label.slice(0, -1), isFolder: true, description });
    } else {
      if (target !== label) {
        malformed.push(`the line for the file ${label} links to ${target}: ${line}`);
      }
      lines.push({ name: label, isFolder: false, description });
    }
  }
  return { lines, malformed };
}
