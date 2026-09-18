/**
 * Unit tests of the Lore reader's pure parts: the keys of each kind of card and
 * the lines of an index. The frontmatter subset is tested in
 * `frontmatter.test.ts`. Reading folders is in `lore.int.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LORE_PARTS,
  LORE_PART_KIND,
  LORE_PILLARS,
  type LoreFrontmatter,
  type LorePart,
  parseLoreIndex,
  readLoreCard,
} from '../../src/index.js';

// ---------- readLoreCard ----------

const VERB: LoreFrontmatter = {
  type: 'verb',
  name: 'spec-draft',
  pillar: 'specifying',
  mode: 'read-only',
  invoked_by: ['human-lead', 'specify'],
};
const PROCESS: LoreFrontmatter = {
  type: 'process',
  name: 'specify',
  pillar: 'specifying',
  steps: ['open', 'confirm'],
  gates: ['confirm'],
  unattended: true,
};
const CONTRACT: LoreFrontmatter = {
  type: 'contract',
  name: 'write-guard',
  pillar: 'working',
  target: 'everything',
  check: 'lore/contracts/core/write-guard.py',
  when: 'before',
};
const MIRROR: LoreFrontmatter = {
  type: 'mirror',
  payload: 'publish',
  generator: 'lore/mirrors/generators/folder-skeleton.py',
  skeleton: ['specs/', 'specs/index.md'],
};
const CORPUS: LoreFrontmatter = {
  type: 'corpus',
  term: 'Human Lead',
  points_at: ['lore/space.md#name', 'https://example.com/a'],
};

test('the constants name the five parts, the five pillars and the kind of each part', () => {
  assert.deepEqual(LORE_PARTS, ['corpus', 'verbs', 'processes', 'contracts', 'mirrors']);
  assert.deepEqual(LORE_PILLARS, ['specifying', 'planning', 'working', 'producing', 'shaping']);
  assert.deepEqual(LORE_PART_KIND, {
    corpus: 'corpus',
    verbs: 'verb',
    processes: 'process',
    contracts: 'contract',
    mirrors: 'mirror',
  });
});

test('readLoreCard builds the typed card of each kind', () => {
  assert.deepEqual(readLoreCard(CORPUS, 'corpus', 'human-lead.md'), {
    ok: true,
    value: {
      kind: 'corpus',
      term: 'Human Lead',
      pointsAt: ['lore/space.md#name', 'https://example.com/a'],
    },
  });
  assert.deepEqual(readLoreCard(VERB, 'verbs', 'spec-draft.md'), {
    ok: true,
    value: {
      kind: 'verb',
      name: 'spec-draft',
      pillar: 'specifying',
      mode: 'read-only',
      invokedBy: ['human-lead', 'specify'],
    },
  });
  assert.deepEqual(readLoreCard(PROCESS, 'processes', 'specify.md'), {
    ok: true,
    value: {
      kind: 'process',
      name: 'specify',
      pillar: 'specifying',
      steps: ['open', 'confirm'],
      gates: ['confirm'],
      unattended: true,
    },
  });
  assert.deepEqual(readLoreCard(CONTRACT, 'contracts', 'write-guard.md'), {
    ok: true,
    value: {
      kind: 'contract',
      name: 'write-guard',
      pillar: 'working',
      target: 'everything',
      payload: null,
      check: 'lore/contracts/core/write-guard.py',
      when: 'before',
    },
  });
  assert.deepEqual(
    readLoreCard(
      { ...CONTRACT, target: 'payload', payload: 'publish', check: null, when: null },
      'contracts',
      'write-guard.md',
    ),
    {
      ok: true,
      value: {
        kind: 'contract',
        name: 'write-guard',
        pillar: 'working',
        target: 'payload',
        payload: 'publish',
        check: null,
        when: null,
      },
    },
  );
  assert.deepEqual(readLoreCard(MIRROR, 'mirrors', 'publish.md'), {
    ok: true,
    value: {
      kind: 'mirror',
      payload: 'publish',
      generator: 'lore/mirrors/generators/folder-skeleton.py',
      skeleton: ['specs/', 'specs/index.md'],
    },
  });
});

test('readLoreCard returns a sentence for a card that does not fit its kind', () => {
  const { mode: _mode, ...verbWithoutMode } = VERB;
  const refused: [string, LoreFrontmatter, LorePart, string, RegExp][] = [
    ['an unknown key', { ...VERB, description: 'x' }, 'verbs', 'spec-draft.md', /description/],
    ['a missing key', verbWithoutMode, 'verbs', 'spec-draft.md', /the key mode is missing/],
    ['no type', { name: 'spec-draft' }, 'verbs', 'spec-draft.md', /no key type/],
    ['an unknown type', { ...VERB, type: 'skill' }, 'verbs', 'spec-draft.md', /type: "skill"/],
    ['a type of another part', VERB, 'processes', 'spec-draft.md', /has type: process/],
    ['an unknown pillar', { ...VERB, pillar: 'reviewing' }, 'verbs', 'spec-draft.md', /pillar/],
    ['an unknown mode', { ...VERB, mode: 'write' }, 'verbs', 'spec-draft.md', /mode/],
    ['a verb name of one word', { ...VERB, name: 'draft' }, 'verbs', 'draft.md', /hyphenated/],
    ['no invoker', { ...VERB, invoked_by: [] }, 'verbs', 'spec-draft.md', /at least one/],
    ['invoked_by as text', { ...VERB, invoked_by: 'me' }, 'verbs', 'spec-draft.md', /list/],
    ['a file not named after the verb', VERB, 'verbs', 'draft-spec.md', /draft-spec\.md/],
    ['a file name in upper case', VERB, 'verbs', 'Spec-Draft.md', /file name/],
    ['a process name of two words', { ...PROCESS, name: 'a-b' }, 'processes', 'a-b.md', /one word/],
    [
      'a gate that is not a step',
      { ...PROCESS, gates: ['agree'] },
      'processes',
      'specify.md',
      /agree/,
    ],
    [
      'a step twice',
      { ...PROCESS, steps: ['open', 'open'], gates: [] },
      'processes',
      'specify.md',
      /twice/,
    ],
    ['no steps', { ...PROCESS, steps: [], gates: [] }, 'processes', 'specify.md', /steps must not/],
    [
      'unattended as text',
      { ...PROCESS, unattended: 'true' },
      'processes',
      'specify.md',
      /true or false/,
    ],
    [
      'an unknown target',
      { ...CONTRACT, target: 'workbench' },
      'contracts',
      'write-guard.md',
      /target/,
    ],
    [
      'payload without target payload',
      { ...CONTRACT, payload: 'publish' },
      'contracts',
      'write-guard.md',
      /only with target/,
    ],
    [
      'a rule-only contract with when',
      { ...CONTRACT, check: null },
      'contracts',
      'write-guard.md',
      /when must be null/,
    ],
    [
      'a check that is not .py',
      { ...CONTRACT, check: 'lore/x.sh' },
      'contracts',
      'write-guard.md',
      /\.py/,
    ],
    [
      'a check that starts with a slash',
      { ...CONTRACT, check: '/etc/x.py' },
      'contracts',
      'write-guard.md',
      /relative/,
    ],
    ['an unknown when', { ...CONTRACT, when: 'during' }, 'contracts', 'write-guard.md', /when/],
    [
      'a skeleton that is not a list',
      { ...MIRROR, skeleton: 'specs/' },
      'mirrors',
      'publish.md',
      /skeleton/,
    ],
    ['a mirror not named after its payload', MIRROR, 'mirrors', 'specs.md', /publish\.md/],
    ['a corpus file not named after its term', CORPUS, 'corpus', 'lead.md', /human-lead\.md/],
    [
      'points_at with a bad item',
      { ...CORPUS, points_at: ['./x'] },
      'corpus',
      'human-lead.md',
      /points_at/,
    ],
  ];
  for (const [what, data, part, fileName, sentence] of refused) {
    const card = readLoreCard(data, part, fileName);
    assert.equal(card.ok, false, `this must be refused: ${what}`);
    if (!card.ok) {
      assert.ok(
        card.error.some((message) => sentence.test(message)),
        `${what}: ${JSON.stringify(card.error)}`,
      );
    }
  }
});

// ---------- parseLoreIndex ----------

test('parseLoreIndex reads a line per file and per folder, with its sentence', () => {
  const body = [
    '',
    '# Verbs',
    '',
    'Prose that is not a line of the index.',
    '',
    '```',
    '- [example.md](./example.md): a line inside a fenced block is an example.',
    '```',
    '',
    '- [spec-draft.md](./spec-draft.md): starts a spec or continues one: the draft is in the Workbench.',
    '- [write-guard.py](./write-guard.py): the check script of write-guard.  ',
    '- [default/](./default/index.md): the verbs that ship with AI-Lore.',
    '1. A numbered line is prose.',
  ].join('\n');
  assert.deepEqual(parseLoreIndex(body), {
    lines: [
      {
        name: 'spec-draft.md',
        isFolder: false,
        description: 'starts a spec or continues one: the draft is in the Workbench.',
      },
      { name: 'write-guard.py', isFolder: false, description: 'the check script of write-guard.' },
      { name: 'default', isFolder: true, description: 'the verbs that ship with AI-Lore.' },
    ],
    malformed: [],
  });
});

test('parseLoreIndex returns the lines that are not in the form of an index line', () => {
  const index = parseLoreIndex(
    [
      '- a plain bullet',
      '- [a.md](./a.md) no colon',
      '- [a.md](./a.md):',
      '- [a.md](a.md): no dot and slash.',
      '- [b.md](./c.md): the link goes to another file.',
      '- [core/](./core/): the link does not go to the index.',
    ].join('\n'),
  );
  assert.equal(index.malformed.length, 6);
  for (const sentence of index.malformed) assert.match(sentence, /line/);
  // A line in the right form counts as listed even when its link is wrong.
  assert.deepEqual(
    index.lines.map((line) => line.name),
    ['b.md', 'core'],
  );
});
