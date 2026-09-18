/**
 * Reading the text of a v0.8 file: its frontmatter, its title, its `##`
 * sections. Pure functions over text; nothing here touches a file.
 *
 * The frontmatter of a v0.8 file is ordinary YAML, which the 1.0 subset reader
 * does not accept. It is read with `js-yaml` under the failsafe schema: every
 * scalar is text, no custom tag is known, and a block over the size cap is not
 * given to the parser. A block that the parser refuses is read line by line
 * for its top-level `key: value` pairs, and the refusal is returned as a
 * sentence. Nothing here throws.
 */

import { FAILSAFE_SCHEMA, load as loadYaml } from 'js-yaml';
import { errorMessage } from '../result.js';
import type { V08BacklogEntry, V08Reference, V08Section, V08Status } from './v08-types.js';

/** A frontmatter block larger than this is not parsed as YAML. */
export const V08_FRONTMATTER_MAX_BYTES = 64 * 1024;

/** What the frontmatter of a v0.8 file holds, as text. */
export type V08Frontmatter = {
  /** Top-level keys whose value is a scalar. */
  fields: Record<string, string>;
  /** Top-level keys whose value is a list of scalars (`claim`). */
  lists: Record<string, string[]>;
  references: V08Reference[];
  /** Whether the text began with a frontmatter block at all. */
  present: boolean;
  /** Why the block was not read as YAML, or `null`. */
  problem: string | null;
};

export type V08ParsedDocument = { frontmatter: V08Frontmatter; body: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"(.*)"$/.exec(trimmed) ?? /^'(.*)'$/.exec(trimmed);
  return quoted?.[1] ?? trimmed;
}

/** The top-level `key: value` pairs of a block, for a block that is not valid YAML. */
function readLinesAsFields(lines: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields[match[1]] = unquote(match[2]);
  }
  return fields;
}

function fromYaml(value: unknown): Pick<V08Frontmatter, 'fields' | 'lists' | 'references'> | null {
  if (!isRecord(value)) return null;
  const fields: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const references: V08Reference[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      fields[key] = entry;
    } else if (Array.isArray(entry)) {
      if (key === 'references') {
        for (const row of entry) {
          if (isRecord(row) && typeof row.path === 'string') {
            references.push({
              group: typeof row.group === 'string' ? row.group : '',
              path: row.path,
            });
          }
        }
      } else {
        lists[key] = entry.filter((item): item is string => typeof item === 'string');
      }
    }
  }
  return { fields, lists, references };
}

/** Split a v0.8 file into its frontmatter and its body. */
export function parseV08Document(text: string): V08ParsedDocument {
  const clean = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const empty: V08Frontmatter = {
    fields: {},
    lists: {},
    references: [],
    present: false,
    problem: null,
  };
  if (lines[0]?.trimEnd() !== '---') return { frontmatter: empty, body: clean };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd();
    if (line === '---' || line === '...') {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return {
      frontmatter: { ...empty, problem: 'The frontmatter block is opened and never closed.' },
      body: clean,
    };
  }
  const blockLines = lines.slice(1, end);
  const block = blockLines.join('\n');
  const body = lines.slice(end + 1).join('\n');
  const fallback = (problem: string): V08ParsedDocument => ({
    frontmatter: {
      fields: readLinesAsFields(blockLines),
      lists: {},
      references: [],
      present: true,
      problem,
    },
    body,
  });
  if (Buffer.byteLength(block, 'utf8') > V08_FRONTMATTER_MAX_BYTES) {
    return fallback(
      `The frontmatter block is larger than ${V08_FRONTMATTER_MAX_BYTES} bytes and was read line by line.`,
    );
  }
  try {
    const read = fromYaml(loadYaml(block, { schema: FAILSAFE_SCHEMA }));
    if (read === null) {
      return fallback('The frontmatter is not a list of keys and was read line by line.');
    }
    return { frontmatter: { ...read, present: true, problem: null }, body };
  } catch (caught) {
    const reason = errorMessage(caught).split('\n')[0] ?? '';
    return fallback(`The frontmatter is not valid YAML and was read line by line: ${reason}`);
  }
}

/** The parts of a body: its `#` title, the text before the first `##`, and the `##` sections. */
export type V08Body = { heading: string | null; intro: string; sections: V08Section[] };

/** Split a body at its headings of level one and two. A heading inside a fenced block is text. */
export function splitV08Body(body: string): V08Body {
  const lines = body.split(/\r?\n/);
  let heading: string | null = null;
  const intro: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      const marker = fenceMatch[1].slice(0, 3);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    }
    const current = sections[sections.length - 1];
    if (fence === null && fenceMatch === null) {
      const levelTwo = /^##[ \t]+(.+?)[ \t#]*$/.exec(line);
      if (levelTwo?.[1] !== undefined) {
        sections.push({ heading: levelTwo[1].trim(), lines: [] });
        continue;
      }
      const levelOne = /^#[ \t]+(.+?)[ \t#]*$/.exec(line);
      if (levelOne?.[1] !== undefined && heading === null && sections.length === 0) {
        heading = levelOne[1].trim();
        continue;
      }
    }
    if (current === undefined) intro.push(line);
    else current.lines.push(line);
  }
  return {
    heading,
    intro: intro.join('\n').trim(),
    sections: sections.map((section) => ({
      heading: section.heading,
      text: section.lines.join('\n').trim(),
    })),
  };
}

/** The body without its `#` title line. */
export function bodyUnderTitle(body: string): string {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() !== '');
  if (index !== -1 && /^#[ \t]+/.test(lines[index] ?? '')) lines.splice(0, index + 1);
  return lines.join('\n').trim();
}

/** The four values of a v0.8 status, read without regard to case; anything else is `other`. */
export function normaliseV08Status(text: string | null | undefined): V08Status {
  const value = (text ?? '').trim().toLowerCase().replace(/[-_]/g, ' ');
  if (value === 'draft' || value === 'paused' || value === 'in progress' || value === 'done') {
    return value;
  }
  return 'other';
}

/** A row of `status.stack.md`. */
export type V08StackRow = {
  name: string;
  /** The link's address, relative to `status/`. */
  link: string;
  statusText: string;
  activeTrack: string | null;
};

/** The rows of the registry table: a first cell that is a markdown link, then the status, then the track. */
export function parseV08Stack(body: string): V08StackRow[] {
  const rows: V08StackRow[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cells[0] ?? '');
    if (link?.[1] === undefined || link[2] === undefined) continue;
    const active = (cells[2] ?? '').replace(/`/g, '').trim();
    rows.push({
      name: link[1].trim(),
      link: link[2].trim(),
      statusText: (cells[1] ?? '').replace(/`/g, '').trim(),
      activeTrack: active === '' ? null : active,
    });
  }
  return rows;
}

const ENTRY_TITLE_MAX = 120;

/** Headings of a backlog file that belong to the card's structure and are not entries. */
const BACKLOG_STRUCTURE_HEADING = /^(purpose|journal trail)\b/i;

/**
 * The entries of a backlog file: its `##` sections other than `Purpose` and
 * `Journal trail`, or, when it has none, its list items at the left margin.
 */
export function readV08BacklogEntries(body: string): {
  entries: V08BacklogEntry[];
  entriesFrom: 'sections' | 'list-items' | 'none';
} {
  const split = splitV08Body(body);
  const sections = split.sections.filter(
    (section) => !BACKLOG_STRUCTURE_HEADING.test(section.heading),
  );
  if (sections.length > 0) {
    return {
      entries: sections.map((section) => ({ title: section.heading, text: section.text })),
      entriesFrom: 'sections',
    };
  }
  const items: string[][] = [];
  for (const line of split.intro.split('\n')) {
    if (/^([0-9]+[.)]|[-*+])[ \t]+/.test(line)) {
      items.push([line.replace(/^([0-9]+[.)]|[-*+])[ \t]+/, '')]);
    } else if (items.length > 0 && (line.trim() === '' || /^[ \t]/.test(line))) {
      items[items.length - 1]?.push(line.trim());
    } else if (line.trim() !== '') {
      // A paragraph at the left margin ends the list; a later item starts a new one.
      if (items.length > 0) items[items.length - 1]?.push(line.trim());
    }
  }
  if (items.length === 0) return { entries: [], entriesFrom: 'none' };
  return {
    entries: items.map((item) => {
      const text = item.join('\n').trim();
      const first = (item[0] ?? '').trim();
      return {
        title: first.length > ENTRY_TITLE_MAX ? `${first.slice(0, ENTRY_TITLE_MAX - 1)}…` : first,
        text,
      };
    }),
    entriesFrom: 'list-items',
  };
}

/** The first `##` section whose heading begins with the word Handover, in any case. */
export function findV08Handover(body: string): V08Section | null {
  return (
    splitV08Body(body).sections.find((section) => /^handover\b/i.test(section.heading)) ?? null
  );
}

/** Whether a fenced block draws a folder tree (`├──`, `└──`), which is a skeleton and not prose. */
function isTreeBlock(lines: readonly string[]): boolean {
  return lines.some((line) => /[├└]──|^\s*\|--|^\s*`--/.test(line));
}

/** The prose of a mirror node: the body under the title, without fenced blocks that draw a folder tree. */
export function mirrorProse(body: string): string {
  const kept: string[] = [];
  let block: string[] | null = null;
  let fence = '';
  for (const line of bodyUnderTitle(body).split('\n')) {
    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (block === null) {
      if (fenceMatch?.[1] !== undefined) {
        block = [line];
        fence = fenceMatch[1].slice(0, 3);
      } else {
        kept.push(line);
      }
      continue;
    }
    block.push(line);
    if (fenceMatch?.[1]?.startsWith(fence) === true) {
      if (!isTreeBlock(block)) kept.push(...block);
      block = null;
    }
  }
  if (block !== null) kept.push(...block);
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The addresses of the images a markdown text shows (`![alt](address)`), without any title text. */
export function markdownImageLinks(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)>]+?)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1].trim());
  }
  return found;
}

/** The first paragraph of prose of a text: not a heading, a quote, a list, a table, an image or a fence. */
export function firstParagraph(body: string, maxLength = 600): string | null {
  const paragraphs = bodyUnderTitle(body).split(/\n[ \t]*\n/);
  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (text === '' || /^(#|>|[-*+] |[0-9]+[.)] |\||!\[|```|~~~|<)/.test(text)) continue;
    const oneLine = text.replace(/\s+/g, ' ');
    return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}…` : oneLine;
  }
  return null;
}
