import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import type {
  MemoryFileType,
  MemoryFrontmatter,
  ParsedMemoryFile,
  ReferenceLink,
} from './types.js';

// Matches the frontmatter fence pair exactly, without swallowing leading
// whitespace between the closing `---\n` and the body — that blank line
// belongs to the body.
const FRONTMATTER_DELIMITER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

const KNOWN_TYPES: ReadonlySet<MemoryFileType> = new Set<MemoryFileType>([
  'status',
  'focus',
  'at-node',
  'journal',
  'blueprint',
  'kt-node',
  'save-point',
  'index',
  'reference',
]);

/**
 * Parse a Memory file's content into structured frontmatter + body.
 *
 * Missing frontmatter is recoverable — returns `{ frontmatter: null, body: raw }`
 * so files without a YAML header (dated journal sessions, anything pre-v0.5)
 * still render. Malformed frontmatter is also recoverable — same shape, with
 * a `warning` describing what failed.
 */
export function parseMemoryFile(content: string): ParsedMemoryFile {
  const match = content.match(FRONTMATTER_DELIMITER);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlText = match[1] ?? '';
  const body = match[2] ?? '';

  let raw: unknown;
  try {
    raw = loadYaml(yamlText);
  } catch (err) {
    return {
      frontmatter: null,
      body,
      warning: `frontmatter YAML parse error: ${(err as Error).message}`,
    };
  }

  if (!isRecord(raw)) {
    return {
      frontmatter: null,
      body,
      warning: 'frontmatter is not a YAML mapping',
    };
  }

  const validated = validateFrontmatter(raw);
  if ('warning' in validated) {
    return { frontmatter: null, body, warning: validated.warning };
  }

  return { frontmatter: validated.frontmatter, body };
}

/** Read a file from disk and parse its frontmatter + body. */
export function parseMemoryFileSync(absPath: string): ParsedMemoryFile {
  const content = readFileSync(absPath, 'utf8');
  return parseMemoryFile(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function validateFrontmatter(
  raw: Record<string, unknown>,
): { frontmatter: MemoryFrontmatter } | { warning: string } {
  const type = raw.type;
  if (!isString(type)) return { warning: 'frontmatter missing required `type` field' };
  if (!KNOWN_TYPES.has(type as MemoryFileType)) {
    return { warning: `frontmatter has unknown type: ${type}` };
  }
  const title = raw.title;
  if (!isString(title)) return { warning: 'frontmatter missing required `title` field' };

  // `updated` is best-effort metadata the companion stores but never keys on.
  // Real-world projects drift from the schema — e.g. save-points generated
  // without it — and a read-only viewer should still surface those files rather
  // than drop the whole list. Tolerate a missing/malformed `updated`: fall back
  // to `date` when present, otherwise empty.
  const rawUpdated = raw.updated;
  const updated = isDateLike(rawUpdated)
    ? normalizeDate(rawUpdated)
    : isDateLike(raw.date)
      ? normalizeDate(raw.date)
      : '';

  const references = parseReferences(raw.references);
  if ('warning' in references) return references;

  const common = {
    type: type as MemoryFileType,
    title,
    updated,
    references: references.value,
  };

  return assembleByType(common, raw);
}

/**
 * YAML's bare-date pattern (`2026-05-26`) parses to a Date instance; quoted
 * strings stay strings. Accept both shapes and normalize to ISO date strings.
 */
function isDateLike(value: unknown): value is string | Date {
  if (isString(value)) return /^\d{4}-\d{2}-\d{2}/.test(value);
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function normalizeDate(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return value;
}

function parseReferences(raw: unknown): { value: ReferenceLink[] } | { warning: string } {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { warning: '`references` must be a list' };
  const list: ReferenceLink[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return { warning: 'every `references` entry must be a mapping' };
    const group = entry.group;
    const path = entry.path;
    if (!isString(group) || !isString(path)) {
      return { warning: 'every `references` entry needs string `group` and `path`' };
    }
    list.push({ group, path });
  }
  return { value: list };
}

function assembleByType(
  common: {
    type: MemoryFileType;
    title: string;
    updated: string;
    references: ReferenceLink[];
  },
  raw: Record<string, unknown>,
): { frontmatter: MemoryFrontmatter } | { warning: string } {
  switch (common.type) {
    case 'status': {
      const active_focus = raw.active_focus;
      const posture = raw.posture;
      const dials = raw.dials;
      if (!isString(active_focus)) {
        return { warning: 'status frontmatter missing `active_focus` (string)' };
      }
      if (!isPosture(posture)) {
        return { warning: 'status frontmatter has invalid `posture`' };
      }
      const parsedDials = parseDials(dials);
      if ('warning' in parsedDials) return parsedDials;
      return {
        frontmatter: {
          ...common,
          type: 'status',
          active_focus,
          posture,
          dials: parsedDials.value,
        },
      };
    }
    case 'focus': {
      const status = raw.status;
      const focus_type = raw.focus_type;
      if (!isFocusStatus(status)) {
        return { warning: 'focus frontmatter has invalid `status`' };
      }
      if (focus_type !== 'build' && focus_type !== 'goal') {
        return { warning: 'focus frontmatter has invalid `focus_type`' };
      }
      return {
        frontmatter: { ...common, type: 'focus', status, focus_type },
      };
    }
    case 'at-node': {
      const node_kind = raw.node_kind;
      const gated = raw.gated;
      const status = raw.status;
      if (node_kind !== 'container' && node_kind !== 'leaf') {
        return { warning: 'at-node frontmatter has invalid `node_kind`' };
      }
      if (!isBoolean(gated)) {
        return { warning: 'at-node frontmatter `gated` must be boolean' };
      }
      if (!isFocusStatus(status)) {
        return { warning: 'at-node frontmatter has invalid `status`' };
      }
      return {
        frontmatter: { ...common, type: 'at-node', node_kind, gated, status },
      };
    }
    case 'journal': {
      const date = raw.date;
      const session = raw.session;
      const focus = raw.focus;
      const dials = raw.dials;
      const posture = raw.posture;
      if (!isDateLike(date)) return { warning: 'journal frontmatter `date` invalid' };
      if (!isString(session)) return { warning: 'journal frontmatter `session` must be string' };
      if (!isString(focus)) return { warning: 'journal frontmatter `focus` must be string' };
      if (!isPosture(posture)) return { warning: 'journal frontmatter has invalid `posture`' };
      const parsedDials = parseDials(dials);
      if ('warning' in parsedDials) return parsedDials;
      return {
        frontmatter: {
          ...common,
          type: 'journal',
          date: normalizeDate(date),
          session,
          focus,
          posture,
          dials: parsedDials.value,
        },
      };
    }
    case 'blueprint': {
      const branch = raw.branch;
      if (branch !== 'contracts' && branch !== 'processes' && branch !== 'mirror') {
        return { warning: 'blueprint frontmatter has invalid `branch`' };
      }
      return { frontmatter: { ...common, type: 'blueprint', branch } };
    }
    case 'kt-node': {
      const branch = raw.branch;
      if (branch !== 'reconciled' && branch !== 'working' && branch !== 'notepad') {
        return { warning: 'kt-node frontmatter has invalid `branch`' };
      }
      return { frontmatter: { ...common, type: 'kt-node', branch } };
    }
    case 'save-point': {
      const date = raw.date;
      const lore_commit = raw.lore_commit;
      const payload_commit = raw.payload_commit;
      if (!isDateLike(date)) return { warning: 'save-point frontmatter `date` invalid' };
      if (!isString(lore_commit)) {
        return { warning: 'save-point frontmatter `lore_commit` must be string' };
      }
      if (!isString(payload_commit)) {
        return { warning: 'save-point frontmatter `payload_commit` must be string' };
      }
      return {
        frontmatter: {
          ...common,
          type: 'save-point',
          date: normalizeDate(date),
          lore_commit,
          payload_commit,
        },
      };
    }
    case 'index':
      return { frontmatter: { ...common, type: 'index' } };
    case 'reference': {
      const target_path = raw.target_path;
      const purpose = raw.purpose;
      const scope = raw.scope;
      if (!isString(target_path)) {
        return { warning: 'reference frontmatter missing `target_path` (string)' };
      }
      if (!isString(purpose)) {
        return { warning: 'reference frontmatter missing `purpose` (string)' };
      }
      if (!isString(scope)) return { warning: 'reference frontmatter missing `scope` (string)' };
      return {
        frontmatter: { ...common, type: 'reference', target_path, purpose, scope },
      };
    }
  }
}

function isPosture(value: unknown): value is 'chat' | 'plan' | 'reshape' | 'execute' {
  return value === 'chat' || value === 'plan' || value === 'reshape' || value === 'execute';
}

function isFocusStatus(
  value: unknown,
): value is 'Pending' | 'Active' | 'Paused' | 'Review' | 'Done' | 'Achieved' {
  return (
    value === 'Pending' ||
    value === 'Active' ||
    value === 'Paused' ||
    value === 'Review' ||
    value === 'Done' ||
    value === 'Achieved'
  );
}

function isAltitude(value: unknown): value is 'low' | 'mid' | 'high' {
  return value === 'low' || value === 'mid' || value === 'high';
}

function isCommitment(value: unknown): value is 'go' | 'neutral' | 'challenge' {
  return value === 'go' || value === 'neutral' || value === 'challenge';
}

function parseDials(raw: unknown): { value: import('./types.js').Dials } | { warning: string } {
  if (!isRecord(raw)) return { warning: '`dials` must be a mapping' };
  if (!isAltitude(raw.altitude)) {
    return { warning: '`dials.altitude` must be low | mid | high' };
  }
  if (!isCommitment(raw.commitment)) {
    return { warning: '`dials.commitment` must be go | neutral | challenge' };
  }
  return { value: { altitude: raw.altitude, commitment: raw.commitment } };
}
