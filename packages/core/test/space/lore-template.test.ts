/**
 * Checks the AI-Lore 1.0 template under `packages/spec/lore-1.0` in place.
 * It reads the template and writes nothing.
 *
 * What it checks:
 *  - every folder under `lore/`, and `publish/specs/`, has an `index.md` that lists
 *    exactly the folder's children, in the line form that `ai_readme.md` states;
 *  - every markdown file under `lore/` has frontmatter that stays inside the subset
 *    stated in `lore/corpus/core/frontmatter.md`, and that a full YAML reader
 *    (`js-yaml`) reads to the same values as the subset reader below;
 *  - every card has the keys of its kind, as stated in `lore/corpus/core/card.md`,
 *    and so does every example card in that entry.
 *
 * The subset reader in this file is the TypeScript counterpart of the small reader
 * that each Python 3 check script carries. It is deliberately strict: anything the
 * entry "frontmatter" places outside the subset is an error here.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

type Scalar = string | number | boolean | null;
type ScalarMap = Record<string, Scalar>;
type SubsetValue = Scalar | Scalar[] | ScalarMap | ScalarMap[];
type Frontmatter = Record<string, SubsetValue>;

const PILLARS = ['specifying', 'planning', 'working', 'producing', 'shaping'];
const CARD_TYPES = ['corpus', 'verb', 'process', 'contract', 'mirror'];
const CONTRACT_TARGETS = ['everything', 'lore', 'journal', 'plan', 'payload'];
const RESERVED_WORDS = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n'];
const KEY = '[a-z][a-z0-9_]*';
const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const HYPHENATED = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SPACE_PATH = /^[A-Za-z0-9][^\\]*$/;

/** Walks up from this compiled file to the repository root and returns the template folder. */
function findTemplateDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'packages', 'spec', 'lore-1.0');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('packages/spec/lore-1.0 was not found above this test');
    dir = parent;
  }
}

const TEMPLATE = findTemplateDir();
const LORE = join(TEMPLATE, 'lore');

/** A path shown in assertion messages, relative to the template folder. */
function shown(path: string): string {
  return relative(TEMPLATE, path);
}

/** Every folder at or below `dir`, `dir` included. Names that begin with a dot are skipped. */
function foldersUnder(dir: string): string[] {
  const found = [dir];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      found.push(...foldersUnder(join(dir, entry.name)));
    }
  }
  return found;
}

/** Every markdown file at or below `dir`. */
function markdownFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const folder of foldersUnder(dir)) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) found.push(join(folder, entry.name));
    }
  }
  return found;
}

/** The text with every fenced code block removed, so that an example line is not read as a line. */
function withoutFences(text: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join('\n');
}

/** Splits a markdown file into its frontmatter text and its body, or returns null without one. */
function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return { yaml: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

/** Reads one scalar of the subset. Throws with the reason when the text is outside the subset. */
function parseScalar(text: string): Scalar {
  if (/^(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\["\\])*)"$/.exec(text);
    if (!quoted)
      throw new Error(
        `double-quoted text is not closed or has an escape outside \\" and \\\\: ${text}`,
      );
    return (quoted[1] ?? '').replace(/\\(["\\])/g, '$1');
  }
  if (!/^\p{L}/u.test(text)) throw new Error(`plain text must begin with a letter: ${text}`);
  if (/[:#"]/.test(text)) throw new Error(`plain text has a colon, a # or a double quote: ${text}`);
  if (text !== text.trimEnd()) throw new Error(`plain text ends with a space: ${text}`);
  if (RESERVED_WORDS.includes(text.toLowerCase())) {
    throw new Error(`the word ${text} must be written in double quotes`);
  }
  return text;
}

/** Splits `key: value`, where the value is a scalar. */
function parseKeyAndScalar(text: string): { key: string; value: Scalar } {
  const match = new RegExp(`^(${KEY}): (.+)$`).exec(text);
  if (!match) throw new Error(`expected "key: value": ${text}`);
  return { key: match[1] ?? '', value: parseScalar(match[2] ?? '') };
}

/** Adds a key to a map and refuses a key that is already there. */
function setOnce<T>(map: Record<string, T>, key: string, value: T): void {
  if (Object.hasOwn(map, key)) throw new Error(`the key ${key} is written twice`);
  map[key] = value;
}

/** Reads the indented lines under a key: a list of scalars, a map, or a list of maps. */
function parseBlock(lines: string[]): Scalar[] | ScalarMap | ScalarMap[] {
  const first = lines[0] ?? '';
  if (!first.startsWith('  - ')) {
    const map: ScalarMap = {};
    for (const line of lines) {
      if (!line.startsWith('  ') || line.startsWith('   ')) throw new Error(`indentation: ${line}`);
      const { key, value } = parseKeyAndScalar(line.slice(2));
      setOnce(map, key, value);
    }
    return map;
  }
  const scalars: Scalar[] = [];
  const maps: ScalarMap[] = [];
  for (const line of lines) {
    if (line.startsWith('  - ')) {
      const rest = line.slice(4);
      if (rest.startsWith('"') || !rest.includes(':')) {
        scalars.push(parseScalar(rest));
      } else {
        const { key, value } = parseKeyAndScalar(rest);
        maps.push({ [key]: value });
      }
    } else if (line.startsWith('    ') && !line.startsWith('     ')) {
      const current = maps[maps.length - 1];
      if (!current || scalars.length > 0)
        throw new Error(`a key line under a scalar item: ${line}`);
      const { key, value } = parseKeyAndScalar(line.slice(4));
      setOnce(current, key, value);
    } else {
      throw new Error(`indentation: ${line}`);
    }
  }
  if (scalars.length > 0 && maps.length > 0) throw new Error('a list mixes scalars and maps');
  return maps.length > 0 ? maps : scalars;
}

/** Reads frontmatter text written in the subset. Throws when the text is outside the subset. */
function parseSubset(yaml: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = yaml
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.includes('\t')) throw new Error(`a tab in: ${JSON.stringify(line)}`);
    const match = new RegExp(`^(${KEY}):(?: (.+))?$`).exec(line);
    if (!match) throw new Error(`expected a key at the top level: ${line}`);
    const key = match[1] ?? '';
    const inline = match[2];
    i += 1;
    if (inline !== undefined) {
      setOnce<SubsetValue>(result, key, inline === '[]' ? [] : parseScalar(inline));
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && (lines[i] ?? '').startsWith(' ')) {
      const blockLine = lines[i] ?? '';
      if (blockLine.includes('\t')) throw new Error(`a tab in: ${JSON.stringify(blockLine)}`);
      block.push(blockLine);
      i += 1;
    }
    if (block.length === 0) throw new Error(`the key ${key} has no value`);
    setOnce<SubsetValue>(result, key, parseBlock(block));
  }
  return result;
}

/** Reads a file's frontmatter with both readers and requires that they agree. */
function readFrontmatter(text: string, where: string): Frontmatter {
  const split = splitFrontmatter(text);
  assert.ok(split, `${where}: the file must begin with frontmatter between two --- lines`);
  let subset: Frontmatter;
  try {
    subset = parseSubset(split.yaml);
  } catch (error) {
    assert.fail(`${where}: frontmatter is outside the subset: ${(error as Error).message}`);
  }
  assert.deepEqual(loadYaml(split.yaml), subset, `${where}: js-yaml and the subset reader differ`);
  return subset;
}

function isStringList(value: SubsetValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Requires that a card's frontmatter has the keys of its kind, with values of the stated form. */
function checkCard(data: Frontmatter, where: string, fileName: string | null): void {
  const type = data.type;
  assert.ok(typeof type === 'string' && CARD_TYPES.includes(type), `${where}: type is ${type}`);

  const required: Record<string, string[]> = {
    corpus: ['type', 'term', 'points_at'],
    verb: ['type', 'name', 'pillar', 'mode', 'invoked_by'],
    process: ['type', 'name', 'pillar', 'steps', 'gates', 'unattended'],
    contract: ['type', 'name', 'pillar', 'target', 'check', 'when'],
    mirror: ['type', 'payload', 'generator', 'skeleton'],
  };
  const expected = [...(required[type] ?? [])];
  if (type === 'contract' && Object.hasOwn(data, 'payload')) expected.push('payload');
  assert.deepEqual(Object.keys(data).sort(), expected.sort(), `${where}: keys of a ${type} card`);

  const text = (key: string): string => {
    const value = data[key];
    assert.ok(typeof value === 'string' && value !== '', `${where}: ${key} must be text`);
    return value;
  };
  const list = (key: string): string[] => {
    const value = data[key];
    assert.ok(isStringList(value), `${where}: ${key} must be a list of text`);
    return value;
  };
  let expectedFile: string | null = null;

  if (type !== 'corpus' && type !== 'mirror') {
    assert.ok(PILLARS.includes(text('pillar')), `${where}: pillar is ${String(data.pillar)}`);
    assert.match(text('name'), HYPHENATED, `${where}: name`);
    expectedFile = `${text('name')}.md`;
  }
  if (type === 'corpus') {
    const slug = `${text('term').toLowerCase().replace(/ /g, '-')}.md`;
    if (FILE_NAME.test(slug)) expectedFile = slug;
    for (const item of list('points_at')) {
      assert.ok(
        item.startsWith('https://') || SPACE_PATH.test(item),
        `${where}: points_at ${item}`,
      );
    }
  }
  if (type === 'verb') {
    assert.ok(text('name').includes('-'), `${where}: a verb's name is hyphenated`);
    assert.ok(['read-only', 'writing'].includes(text('mode')), `${where}: mode`);
    const invokedBy = list('invoked_by');
    assert.ok(invokedBy.length > 0, `${where}: invoked_by must name at least one invoker`);
    for (const item of invokedBy) assert.match(item, HYPHENATED, `${where}: invoked_by ${item}`);
  }
  if (type === 'process') {
    assert.match(text('name'), /^[a-z0-9]+$/, `${where}: a process's name is one word`);
    const steps = list('steps');
    assert.ok(steps.length > 0, `${where}: steps must not be empty`);
    for (const step of steps) assert.match(step, HYPHENATED, `${where}: step ${step}`);
    assert.equal(new Set(steps).size, steps.length, `${where}: a step is named twice`);
    for (const gate of list('gates')) {
      assert.ok(steps.includes(gate), `${where}: the gate ${gate} is not one of the steps`);
    }
    assert.equal(typeof data.unattended, 'boolean', `${where}: unattended must be true or false`);
  }
  if (type === 'contract') {
    assert.ok(CONTRACT_TARGETS.includes(text('target')), `${where}: target`);
    if (Object.hasOwn(data, 'payload')) {
      assert.equal(data.target, 'payload', `${where}: payload is used only with target: payload`);
      text('payload');
    }
    if (data.check === null) {
      assert.equal(data.when, null, `${where}: when must be null when check is null`);
    } else {
      assert.match(text('check'), SPACE_PATH, `${where}: check`);
      assert.ok(text('check').endsWith('.py'), `${where}: check must be a .py file`);
      assert.ok(['before', 'after', 'both'].includes(text('when')), `${where}: when`);
    }
  }
  if (type === 'mirror') {
    expectedFile = `${text('payload')}.md`;
    assert.match(text('generator'), SPACE_PATH, `${where}: generator`);
    list('skeleton');
  }
  if (fileName !== null) {
    assert.match(fileName, FILE_NAME, `${where}: the file name`);
    if (expectedFile !== null) assert.equal(fileName, expectedFile, `${where}: the file name`);
  }
}

/** The children that an index lists, read from its lines outside fenced blocks. */
function readIndexChildren(indexPath: string): { files: string[]; folders: string[] } {
  const files: string[] = [];
  const folders: string[] = [];
  const body = withoutFences(readFileSync(indexPath, 'utf8'));
  for (const line of body.split('\n')) {
    if (!line.startsWith('- ')) continue;
    const match = /^- \[([^\]]+)\]\(\.\/([^)]+)\): \S.*$/.exec(line);
    assert.ok(match, `${shown(indexPath)}: this line is not in the form of an index line: ${line}`);
    const label = match[1] ?? '';
    const target = match[2] ?? '';
    if (label.endsWith('/')) {
      assert.equal(target, `${label}index.md`, `${shown(indexPath)}: a folder links to its index`);
      folders.push(label.slice(0, -1));
    } else {
      assert.equal(target, label, `${shown(indexPath)}: a file's label is its name`);
      files.push(label);
    }
  }
  return { files, folders };
}

/** Requires that the folder's index lists exactly the folder's children. */
function checkIndex(folder: string): void {
  const indexPath = join(folder, 'index.md');
  assert.ok(existsSync(indexPath), `${shown(folder)}: the folder has no index.md`);
  const entries = readdirSync(folder, { withFileTypes: true }).filter(
    (entry) => !entry.name.startsWith('.') && entry.name !== 'index.md',
  );
  const listed = readIndexChildren(indexPath);
  const actualFiles = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  const actualFolders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(listed.files.sort(), actualFiles.sort(), `${shown(indexPath)}: files listed`);
  assert.deepEqual(
    listed.folders.sort(),
    actualFolders.sort(),
    `${shown(indexPath)}: folders listed`,
  );
}

test('the template has the files that setup copies', () => {
  for (const path of ['ai_readme.md', 'gitignore.template', 'lore/index.md', 'lore/space.md']) {
    assert.ok(existsSync(join(TEMPLATE, path)), `${path} is missing`);
  }
  for (const part of ['corpus', 'verbs', 'processes', 'contracts', 'mirrors']) {
    assert.ok(existsSync(join(LORE, part, 'index.md')), `lore/${part}/index.md is missing`);
  }
  for (const folder of ['corpus/core', 'verbs/core', 'verbs/default', 'processes/core']) {
    assert.ok(existsSync(join(LORE, folder, 'index.md')), `lore/${folder}/index.md is missing`);
  }
  for (const folder of ['processes/default', 'contracts/core', 'mirrors/generators']) {
    assert.ok(existsSync(join(LORE, folder, 'index.md')), `lore/${folder}/index.md is missing`);
  }
  const readme = readFileSync(join(TEMPLATE, 'ai_readme.md'), 'utf8');
  assert.ok(readme.includes('lore/index.md'), 'ai_readme.md must point to lore/index.md');
});

test('gitignore.template ignores the Workbench and the repositories', () => {
  const lines = readFileSync(join(TEMPLATE, 'gitignore.template'), 'utf8').split('\n');
  assert.ok(lines.includes('workbench/'));
  assert.ok(lines.includes('repos/'));
});

test('the spec package ships the template', () => {
  const manifest = JSON.parse(readFileSync(join(TEMPLATE, '..', 'package.json'), 'utf8')) as {
    files?: string[];
  };
  assert.ok(manifest.files?.includes('lore-1.0/'), 'package.json files must include lore-1.0/');
});

test('every folder of the Lore has an index that lists exactly its children', () => {
  for (const folder of foldersUnder(LORE)) checkIndex(folder);
});

test('publish/specs has an index that lists exactly its children', () => {
  checkIndex(join(TEMPLATE, 'publish', 'specs'));
});

test('every markdown file of the Lore has frontmatter inside the subset, with a type', () => {
  for (const path of markdownFilesUnder(LORE)) {
    const data = readFrontmatter(readFileSync(path, 'utf8'), shown(path));
    assert.equal(typeof data.type, 'string', `${shown(path)}: type is missing`);
    if (basename(path) === 'index.md') {
      assert.deepEqual(data, { type: 'index' }, `${shown(path)}: an index has only type: index`);
    }
  }
});

test('lore/space.md is the manifest template', () => {
  const path = join(LORE, 'space.md');
  const data = readFrontmatter(readFileSync(path, 'utf8'), shown(path));
  assert.equal(data.type, 'space');
  assert.equal(data.format, 1);
  assert.deepEqual(Object.keys(data), [
    'type',
    'format',
    'name',
    'github',
    'repositories',
    'publish_areas',
  ]);
  assert.deepEqual(data.github, { repository: '', project: 0 });
  assert.deepEqual(data.repositories, []);
  assert.deepEqual(data.publish_areas, [{ name: 'publish', path: 'publish' }]);
});

test('every card has the keys of its kind and the file name of its kind', () => {
  let cards = 0;
  for (const path of markdownFilesUnder(LORE)) {
    const fileName = basename(path);
    if (fileName === 'index.md' || path === join(LORE, 'space.md')) continue;
    const data = readFrontmatter(readFileSync(path, 'utf8'), shown(path));
    checkCard(data, shown(path), fileName);
    const part = relative(LORE, path).split(/[\\/]/)[0] ?? '';
    const typeOfPart: Record<string, string> = {
      corpus: 'corpus',
      verbs: 'verb',
      processes: 'process',
      contracts: 'contract',
      mirrors: 'mirror',
    };
    assert.equal(data.type, typeOfPart[part], `${shown(path)}: the type does not fit the part`);
    cards += 1;
  }
  assert.ok(cards >= 2, 'the corpus entries card and frontmatter must exist');
});

test('the entry "card" has one valid example for each kind that has no card of its own here', () => {
  const text = readFileSync(join(LORE, 'corpus', 'core', 'card.md'), 'utf8');
  const split = splitFrontmatter(text);
  assert.ok(split);
  const seen = new Set<string>();
  for (const match of split.body.matchAll(/```markdown\n([\s\S]*?)\n```/g)) {
    const data = readFrontmatter(match[1] ?? '', 'an example in card.md');
    checkCard(data, `the ${String(data.type)} example in card.md`, null);
    seen.add(String(data.type));
  }
  assert.deepEqual([...seen].sort(), ['contract', 'mirror', 'process', 'verb']);
});

test('the card check refuses a card that does not have the keys and values of its kind', () => {
  const verb: Frontmatter = {
    type: 'verb',
    name: 'spec-draft',
    pillar: 'specifying',
    mode: 'read-only',
    invoked_by: ['human-lead'],
  };
  const process: Frontmatter = {
    type: 'process',
    name: 'specify',
    pillar: 'specifying',
    steps: ['open', 'confirm'],
    gates: ['confirm'],
    unattended: true,
  };
  const contract: Frontmatter = {
    type: 'contract',
    name: 'write-guard',
    pillar: 'working',
    target: 'everything',
    check: 'lore/contracts/core/write-guard.py',
    when: 'before',
  };
  const mirror: Frontmatter = {
    type: 'mirror',
    payload: 'publish',
    generator: 'lore/mirrors/generators/folder-skeleton.py',
    skeleton: [],
  };
  checkCard(verb, 'a verb', 'spec-draft.md');
  checkCard(process, 'a process', 'specify.md');
  checkCard(contract, 'a contract', 'write-guard.md');
  checkCard(mirror, 'a mirror', 'publish.md');

  const { mode: _mode, ...verbWithoutMode } = verb;
  const refused: [string, Frontmatter, string | null][] = [
    ['an unknown key', { ...verb, description: 'drafts a spec' }, null],
    ['a missing key', verbWithoutMode, null],
    ['an unknown type', { ...verb, type: 'skill' }, null],
    ['an unknown pillar', { ...verb, pillar: 'reviewing' }, null],
    ['an unknown mode', { ...verb, mode: 'write' }, null],
    ['a verb name of one word', { ...verb, name: 'draft' }, null],
    ['no invoker', { ...verb, invoked_by: [] }, null],
    ['a file name that is not the name', verb, 'draft-spec.md'],
    ['a process name of two words', { ...process, name: 'specify-more' }, null],
    ['a gate that is not a step', { ...process, gates: ['agree'] }, null],
    ['a step named twice', { ...process, steps: ['open', 'open'], gates: [] }, null],
    ['unattended as text', { ...process, unattended: 'true' }, null],
    ['an unknown target', { ...contract, target: 'workbench' }, null],
    ['a payload without target payload', { ...contract, payload: 'publish' }, null],
    ['a rule-only contract with when', { ...contract, check: null }, null],
    ['a check that is not a .py file', { ...contract, check: 'lore/contracts/core/x.sh' }, null],
    ['an unknown when', { ...contract, when: 'during' }, null],
    ['a skeleton that is not a list', { ...mirror, skeleton: 'specs/' }, null],
    ['a mirror file not named after its payload', mirror, 'specs.md'],
  ];
  for (const [what, data, fileName] of refused) {
    assert.throws(() => checkCard(data, what, fileName), `this must be refused: ${what}`);
  }
});

test('the subset reader reads the five forms of a value', () => {
  const yaml = [
    '# a comment line',
    'name: specify',
    'quoted: "a \\"b\\" c:\\\\d"',
    'count: 7',
    'flag: false',
    'nothing: null',
    'gates: []',
    'steps:',
    '  - open',
    '  - "1.0"',
    'github:',
    '  repository: example-owner/example-space',
    '  project: 1',
    'repositories:',
    '  - name: example-app',
    '    github: example-owner/example-app',
    '  - name: handbook',
  ].join('\n');
  const expected = {
    name: 'specify',
    quoted: 'a "b" c:\\d',
    count: 7,
    flag: false,
    nothing: null,
    gates: [],
    steps: ['open', '1.0'],
    github: { repository: 'example-owner/example-space', project: 1 },
    repositories: [
      { name: 'example-app', github: 'example-owner/example-app' },
      { name: 'handbook' },
    ],
  };
  assert.deepEqual(parseSubset(yaml), expected);
  assert.deepEqual(loadYaml(yaml), expected);
});

test('the subset reader refuses what the entry "frontmatter" places outside the subset', () => {
  const outside = [
    "name: 'single quotes'",
    'name: specify # a comment at the end of a line',
    'steps: [open, draft]',
    'github: { repository: a }',
    'text: |\n  several\n  lines',
    'github:\n  owner:\n    name: a',
    'steps:\n  - open\n  - name: draft',
    'date: 2026-09-18',
    'version: 1.0',
    'number: 007',
    'answer: yes',
    'answer: True',
    'empty:',
    'name: a\nname: b',
    'steps:\n\t- open',
    'Name: a',
    'address: https://example.com',
  ];
  for (const yaml of outside) {
    assert.throws(() => parseSubset(yaml), `this must be refused: ${JSON.stringify(yaml)}`);
  }
});
