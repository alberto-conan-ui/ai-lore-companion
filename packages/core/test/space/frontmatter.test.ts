/**
 * Tests of the one reader and writer of the frontmatter subset
 * (`src/space/frontmatter/`), which the Lore reader and the Space's manifest
 * both use. The subset is the one the template's corpus entry "frontmatter"
 * fixes, so the tests read every file of the template in place (nothing is
 * written) and refuse a table of inputs that the entry places outside it.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import {
  type LoreFrontmatter,
  parseFrontmatterLines,
  parseLoreFrontmatter,
  serializeLoreFrontmatter,
  splitFrontmatter,
} from '../../src/index.js';
import { loreTemplateDir } from '../support/index.js';

const file = (yaml: string[], body = '\n# Title\n'): string =>
  ['---', ...yaml, '---'].join('\n') + body;

// ---------- splitFrontmatter ----------

test('splitFrontmatter gives the lines between the two --- lines and the body as it is', () => {
  const split = splitFrontmatter('---\na: b\n---\n\n# Title\n\n---\nafter\n');
  assert.deepEqual(split, {
    ok: true,
    value: { lines: ['a: b'], body: '\n# Title\n\n---\nafter\n' },
  });
});

test('splitFrontmatter reports a file with no frontmatter and an open one', () => {
  for (const text of [
    '# Title\n',
    '',
    '---\nname: a\n',
    ' ---\nname: a\n---\n',
    '\uFEFF---\na: b\n---\n',
  ]) {
    const split = splitFrontmatter(text);
    assert.equal(split.ok, false, JSON.stringify(text));
    if (split.ok) continue;
    assert.equal(split.error.kind, 'no-frontmatter', JSON.stringify(text));
    assert.match(split.error.message, /does not begin with frontmatter/);
  }
});

test('CRLF line ends are outside the subset, because the entry says lines end with a line feed', () => {
  const crlf = '---\r\nname: a\r\n---\r\nbody\r\n';
  const split = splitFrontmatter(crlf);
  assert.equal(!split.ok && split.error.kind, 'outside-subset');
  const parsed = parseLoreFrontmatter(crlf);
  assert.equal(!parsed.ok && parsed.error.kind, 'outside-subset');
  assert.match(parsed.ok ? '' : parsed.error.message, /line 1: .*carriage return/);
  // A carriage return on a later line, with line feeds on the --- lines.
  const mixed = parseLoreFrontmatter('---\nname: a\r\n---\n');
  assert.equal(!mixed.ok && mixed.error.kind, 'outside-subset');
  assert.match(mixed.ok ? '' : mixed.error.message, /line 2: a carriage return/);
  // A carriage return inside a line is a line break to YAML.
  const inside = parseLoreFrontmatter('---\nname: a\rb: c\n---\n');
  assert.equal(!inside.ok && inside.error.kind, 'outside-subset');
});

// ---------- the reader ----------

test('the reader reads the five forms of a value and the five scalars, and returns the prose', () => {
  const lines = [
    '# a comment line',
    'name: specify',
    'gates: []',
    '',
    'steps:',
    '  - open',
    '  - "2026-09-18"',
    '  # a comment line inside a block',
    '  - "1.0"',
    'github:',
    '  repository: example-owner/example-space',
    '  project: 1',
    'repositories:',
    '  - name: example-app',
    '    github: example-owner/example-app',
    '  - name: example-site',
    '    github: "https://example.invalid/a#b"',
    '  - name: handbook',
    'count: 0',
    'seven: 7',
    'unattended: false',
    'check: null',
    'role: Human Lead',
    'accent: Árbol ñandú',
    'quoted: "say \\"hi\\" and c:\\\\d"',
    'empty: ""',
    'word: "yes"',
  ];
  const expected = {
    name: 'specify',
    gates: [],
    steps: ['open', '2026-09-18', '1.0'],
    github: { repository: 'example-owner/example-space', project: 1 },
    repositories: [
      { name: 'example-app', github: 'example-owner/example-app' },
      { name: 'example-site', github: 'https://example.invalid/a#b' },
      { name: 'handbook' },
    ],
    count: 0,
    seven: 7,
    unattended: false,
    check: null,
    role: 'Human Lead',
    accent: 'Árbol ñandú',
    quoted: 'say "hi" and c:\\d',
    empty: '',
    word: 'yes',
  };
  assert.deepEqual(parseFrontmatterLines(lines), { ok: true, value: expected });
  // A full YAML reader gets the same values: that is what the subset is for.
  assert.deepEqual(loadYaml(lines.join('\n')), expected);

  const parsed = parseLoreFrontmatter(file(lines, '\n# specify\n\nProse with a --- inside.\n'));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.data, expected);
  // The line break that ends the closing --- line is not part of the prose.
  assert.equal(parsed.value.body, '# specify\n\nProse with a --- inside.\n');
});

test('the reader reads an empty block, and a block of comments, as no keys', () => {
  assert.deepEqual(parseLoreFrontmatter('---\n---\nbody'), {
    ok: true,
    value: { data: {}, body: 'body' },
  });
  assert.deepEqual(parseFrontmatterLines(['# only a comment', '']), { ok: true, value: {} });
});

/**
 * What the entry "frontmatter" places outside the subset, one row per form.
 * Each row: what it is, the lines, and what the message must say (with the
 * number of the line in the file, where line 1 is the opening `---`).
 */
const OUTSIDE: Array<[string, string[], RegExp]> = [
  // Flow forms.
  ['a flow list', ['steps: [a, b]'], /line 2: .*brackets/],
  ['a flow list with spaces', ['steps: [open, draft]'], /line 2: .*brackets/],
  ['a flow map', ['github: {a: b}'], /line 2: .*brackets/],
  ['a flow map with spaces', ['github: { repository: a }'], /line 2: .*brackets/],
  ['a flow list as an item', ['steps:', '  - [a, b]'], /line 3: .*brackets/],
  ['an empty flow map', ['github: {}'], /line 2: .*brackets/],
  ['an empty list as an item', ['steps:', '  - []'], /line 3: .*brackets/],
  // Single quotes.
  ['single quotes', ["name: 'x'"], /line 2: .*single quotes/],
  ['single quotes in an item', ['steps:', "  - 'x'"], /line 3: .*single quotes/],
  // Text on several lines.
  ['a literal block scalar', ['text: |', '  one'], /line 2: .*several lines/],
  ['a folded block scalar', ['text: >', '  one'], /line 2: .*several lines/],
  ['a folded block scalar with a chomping mark', ['text: >-', '  one'], /line 2: .*several lines/],
  ['plain text continued on the next line', ['text: one', '  two'], /line 3: expected a key/],
  ['quoted text continued on the next line', ['text: "one', '  two"'], /line 2: .*not closed/],
  // Comments at the end of a line.
  ['a comment after a value', ['name: x # note'], /line 2: .*#/],
  ['a comment after a key', ['steps: # note', '  - a'], /line 2: /],
  ['a comment after an item', ['steps:', '  - a # note'], /line 3: .*#/],
  ['a comment after quoted text', ['name: "x" # note'], /line 2: .*not closed|line 2: .*escape/],
  // Tabs.
  ['a tab as indentation', ['github:', '\trepository: a'], /line 3: a tab/],
  ['a tab before an item', ['steps:', '\t- open'], /line 3: a tab/],
  ['a tab after the colon', ['name:\tx'], /line 2: a tab/],
  ['a tab inside quoted text', ['name: "a\tb"'], /line 2: a tab/],
  // Words that YAML readers do not agree on.
  ['yes', ['answer: yes'], /line 2: .*double quotes/],
  ['no', ['answer: no'], /line 2: .*double quotes/],
  ['on', ['answer: on'], /line 2: .*double quotes/],
  ['off', ['answer: off'], /line 2: .*double quotes/],
  ['y', ['answer: y'], /line 2: .*double quotes/],
  ['n', ['answer: n'], /line 2: .*double quotes/],
  ['Yes', ['answer: Yes'], /line 2: .*double quotes/],
  ['OFF', ['answer: OFF'], /line 2: .*double quotes/],
  ['True', ['answer: True'], /line 2: .*double quotes/],
  ['NULL', ['answer: NULL'], /line 2: .*double quotes/],
  ['a reserved word as an item', ['steps:', '  - on'], /line 3: .*double quotes/],
  ['the tilde for null', ['answer: ~'], /line 2: .*begins with a letter/],
  // Anchors, aliases and tags.
  ['an anchor', ['a: &x one'], /line 2: .*anchors/],
  ['an alias', ['a: one', 'b: *x'], /line 3: .*anchors/],
  ['a tag', ['a: !!str 1'], /line 2: .*anchors/],
  ['a merge key', ['<<: *x'], /line 2: expected a key/],
  // A key written twice.
  ['a key written twice', ['name: a', 'name: b'], /line 3: the key name is written twice/],
  [
    'a key written twice in a map',
    ['github:', '  a: b', '  a: c'],
    /line 4: the key a is written twice/,
  ],
  [
    'a key written twice in an item',
    ['items:', '  - a: b', '    a: c'],
    /line 4: the key a is written twice/,
  ],
  // More than one document. A line that is exactly --- ends the block, so a second
  // document can only be tried with the other markers.
  ['a document end marker', ['name: a', '...', 'name: b'], /line 3: expected a key/],
  [
    'a document start marker with text',
    ['name: a', '--- second', 'name: b'],
    /line 3: expected a key/,
  ],
  ['a directive', ['%YAML 1.2'], /line 2: expected a key/],
  // Keys without values.
  ['a key with no value and no block', ['name:'], /line 2: the key name has no value/],
  [
    'a key with no value before another key',
    ['empty:', 'name: a'],
    /line 2: the key empty has no value/,
  ],
  ['a key with no value at depth two', ['github:', '  owner:'], /line 3: expected "key: value"/],
  ['a key with no value in an item', ['items:', '  - name:'], /line 3: expected "key: value"/],
  [
    'a key with no value under an item',
    ['items:', '  - name: a', '    path:'],
    /line 4: expected "key: value"/,
  ],
  ['a key with a space and no value', ['name: '], /line 2: expected a key/],
  // Nesting deeper than the five forms.
  ['a map inside a map', ['github:', '  owner:', '    name: x'], /line 3: expected "key: value"/],
  ['a list inside a map', ['github:', '  owners:', '    - x'], /line 3: expected "key: value"/],
  ['a list inside a list', ['items:', '  - - x'], /line 3: /],
  ['a list inside an item', ['items:', '  - name: a', '      - b'], /line 4: .*indented/],
  ['a list that mixes forms', ['items:', '  - one', '  - name: two'], /mixes scalars and maps/],
  ['a key under a scalar item', ['items:', '  - one', '    name: two'], /line 4: .*scalar/],
  // Indentation.
  ['three spaces of indentation', ['github:', '   name: x'], /line 3: .*two spaces/],
  ['one space of indentation', ['github:', ' name: x'], /line 3: .*two spaces/],
  ['an item with no indentation', ['steps:', '- open'], /line 2: the key steps has no value/],
  ['an indented first key', ['  name: x'], /line 2: expected a key/],
  ['two spaces after the colon', ['name:  x'], /line 2: .*begins with a letter/],
  ['no space after the colon', ['name:x'], /line 2: expected a key/],
  // Scalars.
  ['plain text that begins with a digit', ['version: 1.0'], /line 2: .*begins with a letter/],
  ['a date that is not quoted', ['date: 2026-09-18'], /line 2: .*begins with a letter/],
  ['a number with a zero in front', ['count: 007'], /line 2: .*begins with a letter/],
  ['a negative number', ['count: -1'], /line 2: .*begins with a letter/],
  ['a number too large to hold', ['count: 9007199254740993'], /line 2: .*too large/],
  ['plain text with a colon', ['address: https://example.com'], /line 2: .*colon/],
  ['plain text with a double quote', ['name: say "hi"'], /line 2: .*double quote/],
  ['plain text that ends with a space', ['name: abc '], /line 2: .*ends with a space/],
  ['an unknown escape', ['text: "a\\nb"'], /line 2: .*escape/],
  ['the escape of a tab', ['text: "a\\tb"'], /line 2: .*escape/],
  ['a quote that is not closed', ['text: "abc'], /line 2: .*not closed/],
  ['text after the closing quote', ['text: "abc" def'], /line 2: .*not closed|line 2: .*escape/],
  // Keys.
  ['a key in upper case', ['Name: x'], /line 2: expected a key/],
  ['a key with a hyphen', ['points-at: x'], /line 2: expected a key/],
  ['a key that begins with a digit', ['1st: x'], /line 2: expected a key/],
  ['a quoted key', ['"name": x'], /line 2: expected a key/],
  ['a complex key', ['? name', ': x'], /line 2: expected a key/],
  // Line ends and control characters.
  ['a carriage return at the end of a line', ['name: abc\r'], /line 2: a carriage return/],
  ['a control character', ['name: a\u0001b'], /line 2: a control character/],
];

test('the reader refuses what the entry "frontmatter" places outside the subset, with the line', () => {
  for (const [label, lines, message] of OUTSIDE) {
    const parsed = parseFrontmatterLines(lines);
    assert.equal(parsed.ok, false, label);
    if (parsed.ok) continue;
    assert.equal(parsed.error.kind, 'outside-subset', label);
    assert.match(parsed.error.message, /^the frontmatter is outside the subset: /, label);
    assert.match(parsed.error.message, message, label);
    // The same through the text of a file.
    const whole = parseLoreFrontmatter(file(lines));
    assert.equal(!whole.ok && whole.error.kind, 'outside-subset', label);
  }
});

test('a second document after the closing --- line is prose, and is not read as frontmatter', () => {
  const parsed = parseLoreFrontmatter('---\nname: a\n---\nname: b\n---\n');
  assert.deepEqual(parsed, { ok: true, value: { data: { name: 'a' }, body: 'name: b\n---\n' } });
});

test('the reader reports text that a full YAML reader does not read to the same values', () => {
  // A character of the C1 range is plain text to the subset reader, and YAML refuses it.
  const refused = parseLoreFrontmatter('---\nname: a\u0080b\n---\n');
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.error.kind, 'readers-differ');
    assert.match(refused.error.message, /^a full YAML reader cannot read the frontmatter: [^\n]+$/);
  }
});

test('every row that the reader accepts is read to the same values by a full YAML reader', () => {
  // Text that looks like another YAML type and is inside the subset as plain text.
  const lines = [
    'a: Infinity',
    'b: NaN',
    'c: nil',
    'd: None',
    'e: a - b',
    'f: a, b',
    'g: a [b] {c}',
    'h: e1',
    'i: x0',
    'j: "0x1F"',
    'k: "1e3"',
    'l: "~"',
    'm: "- a"',
    'n: "a: b"',
    'o: "# not a comment"',
    'p: a & b * c ! d | e > f',
    "q: it's",
    'r: a\\b',
  ];
  const parsed = parseFrontmatterLines(lines);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error.message);
  assert.deepEqual(loadYaml(lines.join('\n')), parsed.value);
  assert.equal(parsed.value.r, 'a\\b');
  assert.equal(parsed.value.j, '0x1F');
});

// ---------- the template ----------

function markdownFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFilesUnder(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path);
  }
  return found.sort();
}

test('every markdown file under lore/ of the template parses, with a type, and a YAML reader agrees', () => {
  const template = loreTemplateDir();
  const files = markdownFilesUnder(join(template, 'lore'));
  assert.ok(files.length >= 40, `the template has ${files.length} markdown files under lore/`);
  const types = new Set<string>();
  for (const path of files) {
    const shown = relative(template, path);
    const text = readFileSync(path, 'utf8');
    const parsed = parseLoreFrontmatter(text);
    assert.ok(parsed.ok, `${shown}: ${parsed.ok ? '' : parsed.error.message}`);
    assert.equal(typeof parsed.value.data.type, 'string', `${shown} has no type`);
    types.add(String(parsed.value.data.type));
    // What is written back is read to the same values: the writer and the reader agree.
    const written = serializeLoreFrontmatter(parsed.value.data);
    assert.ok(written.ok, `${shown}: ${written.ok ? '' : written.error.message}`);
    assert.deepEqual(parseFrontmatterLines(written.value.split('\n')), {
      ok: true,
      value: parsed.value.data,
    });
  }
  assert.deepEqual(
    [...types].sort(),
    ['contract', 'corpus', 'index', 'mirror', 'process', 'space', 'verb'],
    'the template has a file of every type',
  );
});

test('the examples that the entries card and frontmatter give in yaml fences parse', () => {
  const template = loreTemplateDir();
  let examples = 0;
  for (const name of ['card.md', 'frontmatter.md']) {
    const text = readFileSync(join(template, 'lore', 'corpus', 'core', name), 'utf8');
    for (const match of text.matchAll(/```yaml\n([\s\S]*?)```/g)) {
      const lines = (match[1] ?? '').replace(/\n$/, '').split('\n');
      const block = lines[0] === '---' ? lines.slice(1, lines.lastIndexOf('---')) : lines;
      const parsed = parseFrontmatterLines(block);
      assert.ok(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.error.message}\n${match[1]}`);
      examples += 1;
    }
  }
  assert.ok(examples >= 5, `the two entries give ${examples} examples`);
});

// ---------- the writer ----------

test('the writer writes text that the reader and a YAML reader read back', () => {
  const data: LoreFrontmatter = {
    type: 'space',
    version: '1.0',
    date: '2026-09-18',
    word: 'No',
    address: 'https://example.invalid/x#y',
    quoted: 'a "b" \\ c',
    empty: '',
    trailing: 'abc ',
    plain: 'Human Lead',
    path: 'lore/contracts/core/write-guard.py',
    count: 12,
    flag: true,
    nothing: null,
    none: [],
    steps: ['open', '7 days'],
    github: { repository: 'a/b', project: 3 },
    items: [{ name: 'one', path: 'x/y' }, { name: 'two' }],
  };
  const text = serializeLoreFrontmatter(data);
  assert.equal(text.ok, true);
  if (!text.ok) return;
  assert.deepEqual(parseFrontmatterLines(text.value.split('\n')), { ok: true, value: data });
  assert.deepEqual(loadYaml(text.value), data);
  assert.match(text.value, /^version: "1\.0"$/m);
  assert.match(text.value, /^plain: Human Lead$/m);
  assert.match(text.value, /^none: \[\]$/m);
});

test('the writer refuses what the subset cannot hold', () => {
  const cases: Array<[string, Parameters<typeof serializeLoreFrontmatter>[0]]> = [
    ['a line break', { name: 'a\nb' }],
    ['a tab', { name: 'a\tb' }],
    ['a negative number', { count: -1 }],
    ['a fraction', { count: 1.5 }],
    ['an empty map', { github: {} }],
    ['an empty map in a list', { items: [{}] }],
    ['a key in another spelling', { 'Publish-Areas': 'x' }],
    ['a nested key in another spelling', { github: { 'Bad Key': 'x' } }],
  ];
  for (const [label, data] of cases) {
    const text = serializeLoreFrontmatter(data);
    assert.equal(!text.ok && text.error.kind, 'outside-subset', label);
  }
});
