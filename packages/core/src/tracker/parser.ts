/**
 * Tracker file parser.
 *
 * v0.5 reads `status:` and `title:` from each Memory file's YAML
 * frontmatter; files without frontmatter (dated journals, anything pre-v0.5)
 * fall back to the v0.4 body convention — a Status block quote (`> **Status:**
 * Active`) and an H1 line.
 */

import { parseMemoryFile } from '../frontmatter/parser.js';

const STATUS_LINE = /^>\s*\*\*Status:\*\*\s*(\w+)\s*$/m;
const H1_LINE = /^#\s+(.+?)\s*$/m;

export type TrackerStatus = 'Pending' | 'Active' | 'Paused' | 'Review' | 'Done' | 'Achieved';

const VOCAB = new Set<TrackerStatus>(['Pending', 'Active', 'Paused', 'Review', 'Done', 'Achieved']);

/** Returns the Status word, or null if no Status is present or the value is not in vocab. */
export function parseStatus(fileText: string): TrackerStatus | null {
  const parsed = parseMemoryFile(fileText);
  const fm = parsed.frontmatter;
  if (fm && (fm.type === 'focus' || fm.type === 'at-node')) {
    return (VOCAB as Set<string>).has(fm.status) ? (fm.status as TrackerStatus) : null;
  }
  // Body fallback — pre-v0.5 files or unknown frontmatter types.
  const haystack = parsed.body.length > 0 ? parsed.body : fileText;
  const match = haystack.match(STATUS_LINE);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  // Vocabulary check is intentionally case-sensitive — the convention specifies titlecase.
  return (VOCAB as Set<string>).has(raw) ? (raw as TrackerStatus) : null;
}

export function parseTitle(fileText: string): string | null {
  const parsed = parseMemoryFile(fileText);
  if (parsed.frontmatter) return parsed.frontmatter.title;
  const haystack = parsed.body.length > 0 ? parsed.body : fileText;
  const match = haystack.match(H1_LINE);
  return match?.[1]?.trim() ?? null;
}
