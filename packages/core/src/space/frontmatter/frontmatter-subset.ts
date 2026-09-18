/**
 * The one reader and the one writer of the frontmatter subset.
 *
 * The subset is defined by the corpus entry `lore/corpus/core/frontmatter.md`
 * of the Lore template. The Python check scripts read frontmatter line by line
 * with a short reader of their own, so text outside the subset can be read
 * differently by them and by a full YAML reader. This reader therefore accepts
 * exactly the subset and reports anything outside it, with the number of the
 * line in the file. It then reads the same text with `js-yaml` and requires
 * the same values, so that text which a full YAML reader understands
 * differently is reported and not used.
 *
 * The Lore reader (`lore/`) and the Space's manifest (`manifest/`) both read
 * through this module, and the manifest writes through it.
 *
 * Nothing here throws to its caller: text outside the subset comes back as a
 * failure whose message says what is outside it.
 */

import { isDeepStrictEqual } from 'node:util';
import { load as loadYaml } from 'js-yaml';
import { type Failure, type Result, errorMessage, fail, ok } from '../result.js';
import type {
  FrontmatterMap,
  FrontmatterScalar,
  FrontmatterValue,
  LoreFrontmatter,
} from './types.js';

/** The kinds of failure the functions of this module return. */
export type FrontmatterFailureKind =
  /** The file does not begin with a `---` line, or no later `---` line ends the block. */
  | 'no-frontmatter'
  /** The block has something the subset does not allow, or a value that cannot be written in it. */
  | 'outside-subset'
  /** The subset reader and the full YAML reader read different values. */
  | 'readers-differ';

/** The result of a function of this module. */
export type FrontmatterResult<T> = Result<T, Failure<FrontmatterFailureKind>>;

/** A file split at its frontmatter. */
export type SplitFrontmatter = {
  /** The lines between the two `---` lines. The first of them is line 2 of the file. */
  lines: string[];
  /** Everything after the closing `---` line, as it is in the file. */
  body: string;
};

/** A file of the Lore split in two: its frontmatter as values, and the prose after it. */
export type ParsedLoreFile = { data: LoreFrontmatter; body: string };

/** Words that YAML readers do not agree on; as text they are written in double quotes. */
const RESERVED_WORDS = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n'];
const KEY = '[a-z][a-z0-9_]*';
const KEY_ONLY = new RegExp(`^${KEY}$`);
const KEY_LINE = new RegExp(`^(${KEY}):(?: (.+))?$`);
const KEY_AND_SCALAR = new RegExp(`^(${KEY}): (.+)$`);
const WHOLE_NUMBER = /^(0|[1-9][0-9]*)$/;
const QUOTED = /^"((?:[^"\\]|\\["\\])*)"$/;
/** The first line of the frontmatter is line 2 of the file. */
const FIRST_LINE_NUMBER = 2;
/** The start of the message of every `outside-subset` failure of a read; the check scripts use the same words. */
const OUTSIDE_PREFIX = 'the frontmatter is outside the subset: ';

type Line = { text: string; number: number };

/** Thrown inside this file only; the exported functions turn it into a `Failure`. */
class OutsideSubset extends Error {}

function outside(line: Line | null, message: string): never {
  throw new OutsideSubset(line === null ? message : `line ${line.number}: ${message}`);
}

/**
 * Split a markdown file into the lines of its frontmatter and its body. The
 * first line of the file must be exactly `---`, and the next line that is
 * exactly `---` ends the frontmatter. Lines end with a line feed: a file whose
 * first line ends with a carriage return is outside the subset.
 */
export function splitFrontmatter(text: string): FrontmatterResult<SplitFrontmatter> {
  const lines = text.split('\n');
  if (lines[0] === '---\r') {
    return fail(
      'outside-subset',
      `${OUTSIDE_PREFIX}line 1: lines end with a carriage return and a line feed; the subset has the line feed alone`,
    );
  }
  if (lines[0] !== '---') {
    return fail('no-frontmatter', 'the file does not begin with frontmatter between two --- lines');
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return fail(
      'no-frontmatter',
      'the file does not begin with frontmatter between two --- lines: the block is not closed by a --- line',
    );
  }
  return ok({ lines: lines.slice(1, end), body: lines.slice(end + 1).join('\n') });
}

function parseScalar(text: string, line: Line): FrontmatterScalar {
  if (WHOLE_NUMBER.test(text)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) outside(line, `the number ${text} is too large`);
    return value;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text.startsWith('"')) {
    const quoted = QUOTED.exec(text);
    if (quoted === null) {
      outside(line, `quoted text is not closed, or has an escape other than \\" and \\\\: ${text}`);
    }
    return (quoted[1] ?? '').replace(/\\(["\\])/g, '$1');
  }
  if (text.startsWith("'")) outside(line, `text in single quotes is outside the subset: ${text}`);
  if (text.startsWith('[') || text.startsWith('{')) {
    outside(line, `a list or a map between brackets is outside the subset: ${text}`);
  }
  if (text.startsWith('|') || text.startsWith('>')) {
    outside(line, `text that spans several lines is outside the subset: ${text}`);
  }
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    outside(line, `anchors, aliases and tags are outside the subset: ${text}`);
  }
  if (!/^\p{L}/u.test(text)) {
    outside(
      line,
      `plain text begins with a letter; other text is written in double quotes: ${text}`,
    );
  }
  if (/[:#"]/.test(text)) {
    outside(
      line,
      `plain text has a colon, a # or a double quote; write it in double quotes: ${text}`,
    );
  }
  if (text !== text.trimEnd()) outside(line, 'plain text ends with a space');
  if (RESERVED_WORDS.includes(text.toLowerCase())) {
    outside(line, `the word ${text} is written in double quotes`);
  }
  return text;
}

function parseKeyAndScalar(text: string, line: Line): { key: string; value: FrontmatterScalar } {
  const match = KEY_AND_SCALAR.exec(text);
  if (match === null) outside(line, `expected "key: value": ${text}`);
  return { key: match[1] ?? '', value: parseScalar(match[2] ?? '', line) };
}

function setOnce<T>(map: { [key: string]: T }, key: string, value: T, line: Line): void {
  if (Object.hasOwn(map, key)) outside(line, `the key ${key} is written twice`);
  map[key] = value;
}

/** The indented lines under a key: a list of scalars, a map, or a list of maps. */
function parseBlock(
  lines: readonly Line[],
): FrontmatterScalar[] | FrontmatterMap | FrontmatterMap[] {
  const first = lines[0];
  if (first === undefined || !first.text.startsWith('  - ')) {
    const map: FrontmatterMap = {};
    for (const line of lines) {
      if (!line.text.startsWith('  ') || line.text.startsWith('   ')) {
        outside(line, 'a key of a map is indented by two spaces, and nothing is nested deeper');
      }
      const { key, value } = parseKeyAndScalar(line.text.slice(2), line);
      setOnce(map, key, value, line);
    }
    return map;
  }
  const scalars: FrontmatterScalar[] = [];
  const maps: FrontmatterMap[] = [];
  for (const line of lines) {
    if (line.text.startsWith('  - ')) {
      const rest = line.text.slice(4);
      if (rest.startsWith('"') || !rest.includes(':')) {
        scalars.push(parseScalar(rest, line));
      } else {
        const { key, value } = parseKeyAndScalar(rest, line);
        maps.push({ [key]: value });
      }
    } else if (line.text.startsWith('    ') && !line.text.startsWith('     ')) {
      const current = maps[maps.length - 1];
      if (current === undefined || scalars.length > 0) {
        outside(line, 'a key line follows an item that is a scalar');
      }
      const { key, value } = parseKeyAndScalar(line.text.slice(4), line);
      setOnce(current, key, value, line);
    } else {
      outside(line, 'an item is indented by two spaces and its other keys by four');
    }
  }
  if (scalars.length > 0 && maps.length > 0) outside(first, 'a list mixes scalars and maps');
  return maps.length > 0 ? maps : scalars;
}

/** Whether `text` has a character below the space, or the delete character. A tab is one of them. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function parseLines(source: readonly string[]): LoreFrontmatter {
  const lines: Line[] = [];
  source.forEach((text, index) => {
    const line = { text, number: index + FIRST_LINE_NUMBER };
    if (text.includes('\r')) {
      outside(line, 'a carriage return; lines end with a line feed alone');
    }
    if (text.includes('\n')) outside(line, 'a line feed inside a line');
    if (text.trim() === '' || text.trimStart().startsWith('#')) return;
    if (text.includes('\t')) outside(line, 'a tab; indentation is made of spaces');
    if (hasControlCharacter(text)) outside(line, 'a control character');
    lines.push(line);
  });

  const result: LoreFrontmatter = {};
  let index = 0;
  for (;;) {
    const line = lines[index];
    if (line === undefined) break;
    const match = KEY_LINE.exec(line.text);
    if (match === null) outside(line, `expected a key at the top level: ${line.text}`);
    const key = match[1] ?? '';
    const inline = match[2];
    index += 1;
    if (inline !== undefined) {
      setOnce<FrontmatterValue>(
        result,
        key,
        inline === '[]' ? [] : parseScalar(inline, line),
        line,
      );
      continue;
    }
    const block: Line[] = [];
    for (;;) {
      const next = lines[index];
      if (next === undefined || !next.text.startsWith(' ')) break;
      block.push(next);
      index += 1;
    }
    if (block.length === 0) outside(line, `the key ${key} has no value`);
    setOnce<FrontmatterValue>(result, key, parseBlock(block), line);
  }
  return result;
}

/**
 * Read the lines of a frontmatter (as `splitFrontmatter` gives them). Anything
 * outside the subset gives `outside-subset`, with the line number in the file.
 * Text inside the subset that `js-yaml` reads to other values, or cannot read,
 * gives `readers-differ`.
 */
export function parseFrontmatterLines(
  lines: readonly string[],
): FrontmatterResult<LoreFrontmatter> {
  let data: LoreFrontmatter;
  try {
    data = parseLines(lines);
  } catch (caught) {
    if (caught instanceof OutsideSubset) {
      return fail('outside-subset', `${OUTSIDE_PREFIX}${caught.message}`);
    }
    throw caught;
  }

  let full: unknown;
  try {
    full = loadYaml(lines.join('\n')) ?? {};
  } catch (caught) {
    // The YAML reader's message goes on with a picture of the text; its first line is the sentence.
    const reason = errorMessage(caught).split('\n')[0] ?? '';
    return fail('readers-differ', `a full YAML reader cannot read the frontmatter: ${reason}`);
  }
  if (!isDeepStrictEqual(full, data)) {
    return fail(
      'readers-differ',
      'a full YAML reader reads values from the frontmatter that differ from what the subset reader reads',
    );
  }
  return ok(data);
}

/**
 * Split the text of a file of the Lore into its frontmatter and its prose, and
 * read the frontmatter in the subset. The first line must be exactly `---`, and
 * the next line that is exactly `---` ends the block.
 */
export function parseLoreFrontmatter(text: string): FrontmatterResult<ParsedLoreFile> {
  const split = splitFrontmatter(text);
  if (!split.ok) return split;
  const data = parseFrontmatterLines(split.value.lines);
  if (!data.ok) return data;
  return ok({ data: data.value, body: split.value.body });
}

function isPlainText(text: string): boolean {
  return (
    /^\p{L}/u.test(text) &&
    !/[:#"]/.test(text) &&
    text === text.trimEnd() &&
    !RESERVED_WORDS.includes(text.toLowerCase())
  );
}

function formatScalar(value: FrontmatterScalar, where: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      outside(null, `${where}: a number of the subset is a whole number of zero or more`);
    }
    return String(value);
  }
  // Quoted text has two escapes and no form for a line break or a control character.
  if (hasControlCharacter(value)) {
    outside(null, `${where}: text with a line break or a control character cannot be written`);
  }
  if (isPlainText(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isScalar(value: unknown): value is FrontmatterScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function mapLines(map: FrontmatterMap, where: string): string[] {
  const entries = Object.entries(map);
  if (entries.length === 0) outside(null, `${where}: an empty map cannot be written`);
  return entries.map(([key, value]) => {
    if (!KEY_ONLY.test(key)) outside(null, `${where}: ${key} is not a key of the subset`);
    if (!isScalar(value)) outside(null, `${where}.${key}: nothing is nested deeper than this`);
    return `${key}: ${formatScalar(value, `${where}.${key}`)}`;
  });
}

function serializeEntries(data: LoreFrontmatter): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!KEY_ONLY.test(key)) outside(null, `${key} is not a key of the subset`);
    if (isScalar(value)) {
      out.push(`${key}: ${formatScalar(value, key)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${key}: []`);
        continue;
      }
      out.push(`${key}:`);
      const scalars = value.filter(isScalar).length;
      if (scalars !== 0 && scalars !== value.length) {
        outside(null, `${key}: a list mixes scalars and maps`);
      }
      value.forEach((item, index) => {
        const where = `${key}[${index}]`;
        if (isScalar(item)) {
          out.push(`  - ${formatScalar(item, where)}`);
          return;
        }
        mapLines(item, where).forEach((line, position) => {
          out.push(position === 0 ? `  - ${line}` : `    ${line}`);
        });
      });
    } else {
      out.push(`${key}:`);
      for (const line of mapLines(value, key)) out.push(`  ${line}`);
    }
  }
  return out;
}

/**
 * Write a frontmatter in the subset: the lines between the two `---` lines,
 * joined with line feeds, in the order of the keys of `data`. A value that the
 * subset cannot hold (a line break in text, a negative number, an empty map,
 * a key in another spelling) gives `outside-subset`.
 */
export function serializeLoreFrontmatter(data: LoreFrontmatter): FrontmatterResult<string> {
  try {
    return ok(serializeEntries(data).join('\n'));
  } catch (caught) {
    if (caught instanceof OutsideSubset) return fail('outside-subset', caught.message);
    throw caught;
  }
}
