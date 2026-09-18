import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  V08_FRONTMATTER_MAX_BYTES,
  findV08Handover,
  mirrorProse,
  normaliseV08Status,
  parseV08Document,
  parseV08Stack,
  readV08BacklogEntries,
  splitV08Body,
  v08CategoryOf,
} from '../../src/index.js';

test('parseV08Document reads ordinary YAML: scalars as text, lists, and the references rows', () => {
  const parsed = parseV08Document(
    [
      '---',
      'type: focus',
      'title: "A: quoted title"',
      'updated: 2026-09-18',
      'claim:',
      '  - memory/status/x/',
      '  - packages/',
      'references:',
      '  - group: Parent',
      '    path: ./x.index.md',
      '---',
      '',
      '# Heading',
    ].join('\n'),
  );
  assert.equal(parsed.frontmatter.present, true);
  assert.equal(parsed.frontmatter.problem, null);
  assert.equal(parsed.frontmatter.fields.title, 'A: quoted title');
  // The failsafe schema keeps a date as the text it was written as.
  assert.equal(parsed.frontmatter.fields.updated, '2026-09-18');
  assert.deepEqual(parsed.frontmatter.lists.claim, ['memory/status/x/', 'packages/']);
  assert.deepEqual(parsed.frontmatter.references, [{ group: 'Parent', path: './x.index.md' }]);
  assert.equal(parsed.body.trim(), '# Heading');
});

test('parseV08Document never throws: bad YAML, a custom tag, an unclosed block, an oversized block', () => {
  const bad = parseV08Document('---\ntitle: [unclosed\nstatus: paused\n---\nbody');
  assert.match(bad.frontmatter.problem ?? '', /not valid YAML/);
  assert.equal(bad.frontmatter.fields.status, 'paused');
  assert.equal(bad.body, 'body');

  const tagged = parseV08Document('---\ntitle: !!js/function "function () {}"\n---\n');
  assert.notEqual(tagged.frontmatter.problem, null);

  const unclosed = parseV08Document('---\ntitle: x\n');
  assert.match(unclosed.frontmatter.problem ?? '', /never closed/);

  const big = parseV08Document(
    `---\ntitle: big\nfiller: ${'x'.repeat(V08_FRONTMATTER_MAX_BYTES)}\n---\n`,
  );
  assert.match(big.frontmatter.problem ?? '', /larger than/);
  assert.equal(big.frontmatter.fields.title, 'big');

  // A real v0.8 shape: a title with an unquoted ": " is not valid YAML, and the line reading still gets it.
  const colon = parseV08Document(
    '---\ntype: phase\ntitle: M4.1 — investigation: Claude Code\nstatus: done\n---\n',
  );
  assert.notEqual(colon.frontmatter.problem, null);
  assert.equal(colon.frontmatter.fields.title, 'M4.1 — investigation: Claude Code');
  assert.equal(colon.frontmatter.fields.status, 'done');

  const none = parseV08Document('# Only a body\n');
  assert.equal(none.frontmatter.present, false);
  assert.equal(none.frontmatter.problem, null);
});

test('splitV08Body keeps a heading inside a fenced block as text', () => {
  const split = splitV08Body(
    '# Title\n\nIntro.\n\n## One\n\n```\n## not a heading\n```\n\n## Two\n\nText.',
  );
  assert.equal(split.heading, 'Title');
  assert.equal(split.intro, 'Intro.');
  assert.deepEqual(
    split.sections.map((section) => section.heading),
    ['One', 'Two'],
  );
  assert.match(split.sections[0]?.text ?? '', /## not a heading/);
});

test('normaliseV08Status knows the four v0.8 values and calls anything else other', () => {
  assert.equal(normaliseV08Status('In Progress'), 'in progress');
  assert.equal(normaliseV08Status('in-progress'), 'in progress');
  assert.equal(normaliseV08Status('paused'), 'paused');
  assert.equal(normaliseV08Status('Achieved'), 'other');
  assert.equal(normaliseV08Status(null), 'other');
});

test('parseV08Stack reads the rows whose first cell is a link, with status and active track', () => {
  const rows = parseV08Stack(
    [
      'One row per focus.',
      '',
      '| Focus | Status | Active |',
      '|---|---|---|',
      '| [a](./a/a.focus.md) | in progress | home |',
      '| [b](./b/b.focus.md) | paused | |',
      '| not a link | done | |',
    ].join('\n'),
  );
  assert.deepEqual(rows, [
    { name: 'a', link: './a/a.focus.md', statusText: 'in progress', activeTrack: 'home' },
    { name: 'b', link: './b/b.focus.md', statusText: 'paused', activeTrack: null },
  ]);
});

test('findV08Handover finds a heading that begins with the word Handover', () => {
  const found = findV08Handover(
    "## What happened\n\nx\n\n## Handover — where the work stands, what's next\n\nNext: y.\n",
  );
  assert.equal(found?.text, 'Next: y.');
  assert.equal(findV08Handover('## Handovers were discussed\n\nno'), null);
});

test('readV08BacklogEntries takes sections, else list items at the left margin', () => {
  const sections = readV08BacklogEntries('# B\n\n## First\n\nOne.\n\n## Second\n\nTwo.');
  assert.equal(sections.entriesFrom, 'sections');
  assert.deepEqual(
    sections.entries.map((entry) => entry.title),
    ['First', 'Second'],
  );
  const items = readV08BacklogEntries('# B\n\n1. A finding.\n   more of it\n2. Another.');
  assert.equal(items.entriesFrom, 'list-items');
  assert.equal(items.entries.length, 2);
  assert.match(items.entries[0]?.text ?? '', /more of it/);
  assert.equal(readV08BacklogEntries('# B\n\nJust prose.').entriesFrom, 'none');
});

test('mirrorProse drops the title and a fenced folder tree, and keeps other code', () => {
  const prose = mirrorProse(
    [
      '# packages/app',
      '',
      '**What it is.** The app.',
      '',
      '```',
      'src/',
      '├── main/',
      '└── renderer/',
      '```',
      '',
      '```ts',
      'const kept = true;',
      '```',
    ].join('\n'),
  );
  assert.doesNotMatch(prose, /# packages\/app/);
  assert.doesNotMatch(prose, /├──/);
  assert.match(prose, /What it is/);
  assert.match(prose, /const kept = true/);
});

test('v08CategoryOf classifies by path, and tells project content from core content', () => {
  assert.equal(v08CategoryOf('memory/workspace.yaml'), 'manifest');
  assert.equal(v08CategoryOf('memory/status/status.stack.md'), 'stack');
  assert.equal(v08CategoryOf('memory/status/a/B1/B1.stage.md'), 'focus');
  assert.equal(v08CategoryOf('memory/status/archive/x.focus.md'), 'finished-focus');
  assert.equal(v08CategoryOf('memory/blueprint/contracts/x.contract.md'), 'project-contract');
  assert.equal(v08CategoryOf('memory/blueprint/contracts/core/x.contract.md'), 'core-contract');
  assert.equal(v08CategoryOf('memory/blueprint/tooling/core/ai-lore.py'), 'core-tooling');
  assert.equal(v08CategoryOf('memory/blueprint/verbs/core/status.md'), 'core-verb');
  assert.equal(v08CategoryOf('memory/blueprint/tooling/build-script.sh'), 'other');
  assert.equal(v08CategoryOf('memory/notepad/Mind map.mmap'), 'other');
  assert.equal(v08CategoryOf('memory/notepad/notepad.index.md'), 'index');
  assert.equal(v08CategoryOf('references/ai-lore.md'), 'reference');
  assert.equal(v08CategoryOf('.idea/workspace.xml'), 'other');
});
