import { readFileSync, writeFileSync } from 'node:fs';

// Matches the frontmatter fence pair exactly, without swallowing leading
// whitespace between the closing `---\n` and the body — that blank line
// belongs to the body, not the fence.
const FRONTMATTER_DELIMITER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Update one frontmatter field in a Memory file's content, preserving
 * comments, blank lines, and key ordering.
 *
 * Surgical line-level edit — js-yaml would round-trip through an AST that
 * loses comments and reorders keys. We rewrite only the matched line.
 *
 * Supports:
 * - Top-level scalar fields: `dotPath = 'posture'` → updates `posture: <value>`.
 * - One-level-nested scalar fields: `dotPath = 'dials.altitude'` → updates
 *   the `altitude:` line under `dials:`.
 *
 * Returns the new content on success, or `null` if the file has no
 * frontmatter, the target line is not present, or the requested path is
 * malformed.
 */
export function updateFrontmatterField(
  content: string,
  dotPath: string,
  newValue: string,
): string | null {
  const match = content.match(FRONTMATTER_DELIMITER);
  if (!match) return null;

  const fmStart = match.index ?? 0;
  const fmFullLength = match[0].length;
  const fmEnd = fmStart + fmFullLength;
  const fmBody = match[1] ?? '';

  const updated = updateYamlBlock(fmBody, dotPath, newValue);
  if (updated === null) return null;

  return `${content.slice(0, fmStart)}---\n${updated}${updated.endsWith('\n') ? '' : '\n'}---\n${content.slice(fmEnd)}`;
}

/**
 * Read a file, apply `updateFrontmatterField`, and write the result back.
 * Returns true on success, false if the field was not found.
 */
export function updateFrontmatterFieldInFile(
  absPath: string,
  dotPath: string,
  newValue: string,
): boolean {
  const content = readFileSync(absPath, 'utf8');
  const updated = updateFrontmatterField(content, dotPath, newValue);
  if (updated === null) return false;
  writeFileSync(absPath, updated, 'utf8');
  return true;
}

function updateYamlBlock(body: string, dotPath: string, newValue: string): string | null {
  const parts = dotPath.split('.');
  if (parts.length === 1) return updateTopLevelLine(body, parts[0] as string, newValue);
  if (parts.length === 2) {
    return updateNestedLine(body, parts[0] as string, parts[1] as string, newValue);
  }
  return null;
}

function updateTopLevelLine(body: string, key: string, newValue: string): string | null {
  const lines = body.split('\n');
  // A top-level key is at column 0; if a YAML structure (`dials:`) opens
  // below it, indented children that follow share that parent. Top-level
  // lines we touch must match `^<key>:` exactly.
  const lineRe = new RegExp(`^${escapeRegex(key)}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (lineRe.test(line)) {
      lines[i] = `${key}: ${newValue}`;
      return lines.join('\n');
    }
  }
  return null;
}

function updateNestedLine(
  body: string,
  parentKey: string,
  childKey: string,
  newValue: string,
): string | null {
  const lines = body.split('\n');
  const parentRe = new RegExp(`^${escapeRegex(parentKey)}:\\s*$`);
  let parentIdx = -1;
  let parentIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (parentRe.test(lines[i] ?? '')) {
      parentIdx = i;
      parentIndent = leadingSpaces(lines[i] ?? '');
      break;
    }
  }
  if (parentIdx === -1) return null;

  // Look at indented lines below the parent until we hit a line whose
  // indent returns to <= parentIndent (i.e. the next sibling).
  let i = parentIdx + 1;
  let childIndent: number | null = null;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const indent = leadingSpaces(line);
    if (indent <= parentIndent) break;
    if (childIndent === null) childIndent = indent;
    const pad = ' '.repeat(childIndent);
    const childRe = new RegExp(`^${escapeRegex(pad)}${escapeRegex(childKey)}:\\s*(.*)$`);
    if (childRe.test(line)) {
      lines[i] = `${pad}${childKey}: ${newValue}`;
      return lines.join('\n');
    }
    i += 1;
  }
  return null;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
