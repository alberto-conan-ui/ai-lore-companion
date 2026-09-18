/**
 * Integration tests of the Lore reader: small Lores built in temporary folders,
 * and the real template under `packages/spec/lore-1.0`, which is read in place
 * and never written.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import {
  type LoreProblem,
  type LoreProblemKind,
  type ResolvedLore,
  findLoreEntry,
  readLore,
} from '../../src/index.js';
import { loreTemplateDir } from '../support/paths.js';
import { type CleanupHost, useTempDir } from '../support/temp.js';

// ---------- building a small Lore ----------

const card = (yaml: string[], title: string): string =>
  `${['---', ...yaml, '---'].join('\n')}\n\n# ${title}\n\nProse.\n`;

const verb = (name: string, mode = 'read-only'): string =>
  card(
    [
      'type: verb',
      `name: ${name}`,
      'pillar: working',
      `mode: ${mode}`,
      'invoked_by:',
      '  - human-lead',
    ],
    name,
  );

const contract = (name: string, check: string | null): string =>
  card(
    [
      'type: contract',
      `name: ${name}`,
      'pillar: working',
      'target: everything',
      `check: ${check ?? 'null'}`,
      `when: ${check === null ? 'null' : 'before'}`,
    ],
    name,
  );

const corpus = (term: string): string =>
  card(['type: corpus', `term: ${term}`, 'points_at: []'], term);

const PROCESS = card(
  [
    'type: process',
    'name: specify',
    'pillar: specifying',
    'steps:',
    '  - open',
    '  - confirm',
    'gates:',
    '  - confirm',
    'unattended: false',
  ],
  'specify',
);

const MIRROR = card(
  [
    'type: mirror',
    'payload: publish',
    'generator: lore/mirrors/generators/folder-skeleton.py',
    'skeleton:',
    '  - "specs/"',
  ],
  'publish',
);

/** The files of a small Lore that has nothing wrong, by path relative to the Space. */
function wellFormedLore(): Record<string, string> {
  return {
    'lore/corpus/core/card.md': corpus('card'),
    'lore/verbs/core/verb-add.md': verb('verb-add', 'writing'),
    'lore/verbs/default/spec-draft.md': verb('spec-draft'),
    'lore/verbs/default/session-close.md': verb('session-close'),
    'lore/processes/core/index.md': '---\ntype: index\n---\n\n# Processes: core\n\nEmpty.\n',
    'lore/processes/default/specify.md': PROCESS,
    'lore/contracts/core/write-guard.md': contract(
      'write-guard',
      'lore/contracts/core/write-guard.py',
    ),
    'lore/contracts/core/write-guard.py': 'import sys\n',
    'lore/contracts/core/stage-gate.md': contract('stage-gate', null),
    'lore/mirrors/publish.md': MIRROR,
    'lore/mirrors/generators/folder-skeleton.py': 'import sys\n',
  };
}

/** The sentence that a generated index gives to a child. */
const sentenceFor = (name: string): string => `what ${name} is for.`;

/**
 * Write `files` under a new temporary Space and give every folder under `lore/`
 * an index that lists exactly its children, unless `files` has that index.
 */
function buildSpace(t: CleanupHost, files: Record<string, string>): string {
  const space = useTempDir(t, 'ai-lore-lore-');
  for (const [relative, content] of Object.entries(files)) {
    const path = join(space, ...relative.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const writeIndexes = (dir: string): void => {
    const children = readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.name !== 'index.md',
    );
    const indexPath = join(dir, 'index.md');
    try {
      readFileSync(indexPath);
    } catch {
      const lines = children.map((entry) =>
        entry.isDirectory()
          ? `- [${entry.name}/](./${entry.name}/index.md): ${sentenceFor(entry.name)}`
          : `- [${entry.name}](./${entry.name}): ${sentenceFor(entry.name)}`,
      );
      writeFileSync(indexPath, `---\ntype: index\n---\n\n# Index\n\n${lines.join('\n')}\n`);
    }
    for (const entry of children) if (entry.isDirectory()) writeIndexes(join(dir, entry.name));
  };
  writeIndexes(join(space, 'lore'));
  return space;
}

async function read(space: string): Promise<ResolvedLore> {
  const result = await readLore(space);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  return result.value;
}

const names = (entries: { name: string }[]): string[] => entries.map((entry) => entry.name);

function problemsAt(lore: ResolvedLore, path: string, kind: LoreProblemKind): LoreProblem[] {
  return lore.problems.filter((problem) => problem.path === path && problem.kind === kind);
}

/** A hash over every path and every file's content under `dir`, to show that nothing was written. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(folder, entry.name);
      hash.update(path);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

// ---------- a Lore with nothing wrong ----------

test('readLore reads every part, attaches the index sentence and the script, and writes nothing', async (t) => {
  const space = buildSpace(t, wellFormedLore());
  const before = treeHash(space);
  const lore = await read(space);

  assert.deepEqual(lore.problems, []);
  assert.equal(lore.spaceRoot, space);
  assert.equal(lore.loreDir, join(space, 'lore'));
  assert.deepEqual(names(lore.parts.corpus), ['card']);
  assert.deepEqual(names(lore.parts.verbs), ['session-close', 'spec-draft', 'verb-add']);
  assert.deepEqual(names(lore.parts.processes), ['specify']);
  assert.deepEqual(names(lore.parts.contracts), ['stage-gate', 'write-guard']);
  assert.deepEqual(names(lore.parts.mirrors), ['publish']);
  assert.deepEqual(lore.replaced, []);

  assert.deepEqual(findLoreEntry(lore, 'verbs', 'spec-draft'), {
    card: {
      kind: 'verb',
      name: 'spec-draft',
      pillar: 'working',
      mode: 'read-only',
      invokedBy: ['human-lead'],
    },
    part: 'verbs',
    layer: 'default',
    name: 'spec-draft',
    path: join(space, 'lore', 'verbs', 'default', 'spec-draft.md'),
    description: sentenceFor('spec-draft.md'),
    replacesDefault: false,
    script: null,
  });
  assert.equal(findLoreEntry(lore, 'verbs', 'verb-add')?.layer, 'core');
  assert.equal(findLoreEntry(lore, 'mirrors', 'publish')?.layer, 'own');
  assert.equal(findLoreEntry(lore, 'verbs', 'no-such')?.name, undefined);
  assert.equal(findLoreEntry(lore, 'processes', 'spec-draft'), null);

  const guard = findLoreEntry(lore, 'contracts', 'write-guard');
  assert.equal(guard?.script, join(space, 'lore', 'contracts', 'core', 'write-guard.py'));
  assert.equal(guard?.card.when, 'before');
  assert.equal(findLoreEntry(lore, 'contracts', 'stage-gate')?.script, null);
  assert.equal(
    findLoreEntry(lore, 'mirrors', 'publish')?.script,
    join(space, 'lore', 'mirrors', 'generators', 'folder-skeleton.py'),
  );

  assert.equal(treeHash(space), before);
  // The value is plain data, so it crosses IPC as it is.
  assert.deepEqual(JSON.parse(JSON.stringify(lore)), lore);
});

// ---------- layers ----------

test('an own card replaces the default of the same name, and only that one', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/spec-draft.md': verb('spec-draft', 'writing'),
    'lore/verbs/plan-review.md': verb('plan-review'),
  });
  const lore = await read(space);
  assert.deepEqual(lore.problems, []);
  assert.deepEqual(names(lore.parts.verbs), [
    'plan-review',
    'session-close',
    'spec-draft',
    'verb-add',
  ]);

  const used = findLoreEntry(lore, 'verbs', 'spec-draft');
  assert.equal(used?.layer, 'own');
  assert.equal(used?.path, join(space, 'lore', 'verbs', 'spec-draft.md'));
  assert.equal(used?.card.mode, 'writing');
  assert.equal(used?.replacesDefault, true);

  assert.equal(findLoreEntry(lore, 'verbs', 'plan-review')?.replacesDefault, false);
  assert.equal(findLoreEntry(lore, 'verbs', 'session-close')?.layer, 'default');
  assert.deepEqual(
    lore.replaced.map((entry) => entry.path),
    [join(space, 'lore', 'verbs', 'default', 'spec-draft.md')],
  );
});

test('a file outside core/ that takes a core name is reported and not used', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/verb-add.md': verb('verb-add'),
    'lore/verbs/default/verb-add.md': verb('verb-add'),
    'lore/contracts/write-guard.py': 'import os\n',
    // The same name in another part takes nothing.
    'lore/corpus/verb-add.md': corpus('verb add'),
  });
  const lore = await read(space);

  const used = findLoreEntry(lore, 'verbs', 'verb-add');
  assert.equal(used?.layer, 'core');
  assert.equal(used?.card.mode, 'writing');
  assert.equal(names(lore.parts.verbs).filter((name) => name === 'verb-add').length, 1);
  assert.deepEqual(lore.replaced, []);
  assert.equal(findLoreEntry(lore, 'corpus', 'verb-add')?.layer, 'own');

  const taken = lore.problems.filter((problem) => problem.kind === 'core-name-taken');
  assert.deepEqual(taken.map((problem) => problem.path).sort(), [
    join(space, 'lore', 'contracts', 'write-guard.py'),
    join(space, 'lore', 'verbs', 'default', 'verb-add.md'),
    join(space, 'lore', 'verbs', 'verb-add.md'),
  ]);
  for (const problem of taken) assert.match(problem.message, /name of the core file lore\//);
  assert.deepEqual(
    lore.problems.filter((problem) => problem.kind !== 'core-name-taken'),
    [],
  );
});

// ---------- bad content ----------

test('frontmatter that cannot be read is reported and the rest of the Lore is still read', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/default/work-report.md': "---\ntype: verb\nname: 'work-report'\n---\n",
    'lore/verbs/plan-review.md': '# plan-review\n\nNo frontmatter.\n',
    // An own file that cannot be read does not replace the default.
    'lore/verbs/spec-draft.md': '---\ntype: verb\nname: [spec-draft]\n---\n',
    'lore/corpus/core/desk.md': '---\ntype: corpus\nterm: desk\n',
  });
  writeFileSync(join(space, 'lore', 'corpus', 'binary.md'), Buffer.from([0x2d, 0xff, 0xfe, 0x00]));
  // The index of lore/corpus was generated before binary.md was added.
  const lore = await read(space);

  assert.deepEqual(names(lore.parts.verbs), ['session-close', 'spec-draft', 'verb-add']);
  assert.equal(findLoreEntry(lore, 'verbs', 'spec-draft')?.layer, 'default');
  assert.deepEqual(names(lore.parts.corpus), ['card']);
  assert.deepEqual(names(lore.parts.contracts), ['stage-gate', 'write-guard']);

  for (const relative of [
    'lore/verbs/default/work-report.md',
    'lore/verbs/plan-review.md',
    'lore/verbs/spec-draft.md',
    'lore/corpus/core/desk.md',
  ]) {
    const found = problemsAt(lore, join(space, ...relative.split('/')), 'frontmatter');
    assert.equal(found.length, 1, relative);
    assert.match(found[0]?.message ?? '', /frontmatter.*the card was not used$/);
  }
  const binary = problemsAt(lore, join(space, 'lore', 'corpus', 'binary.md'), 'unreadable');
  assert.equal(binary.length, 1);
  assert.match(binary[0]?.message ?? '', /not UTF-8 text/);
});

test('a card that does not have the keys of its kind is reported and not used', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/specify.md': PROCESS,
    'lore/verbs/plan-review.md': verb('review-plan'),
    'lore/processes/plan.md': card(['type: process', 'name: plan', 'pillar: planning'], 'plan'),
  });
  const lore = await read(space);
  assert.deepEqual(names(lore.parts.verbs), ['session-close', 'spec-draft', 'verb-add']);
  assert.deepEqual(names(lore.parts.processes), ['specify']);

  const wrongPart = problemsAt(lore, join(space, 'lore', 'verbs', 'specify.md'), 'card');
  assert.equal(wrongPart.length, 1);
  assert.match(wrongPart[0]?.message ?? '', /type: "process".*lore\/verbs\/ has type: verb/);
  const wrongName = problemsAt(lore, join(space, 'lore', 'verbs', 'plan-review.md'), 'card');
  assert.match(wrongName[0]?.message ?? '', /review-plan\.md/);
  const missing = problemsAt(lore, join(space, 'lore', 'processes', 'plan.md'), 'card');
  assert.deepEqual(missing.map((problem) => problem.message).sort(), [
    'the key gates is missing; the card was not used',
    'the key steps is missing; the card was not used',
    'the key unattended is missing; the card was not used',
  ]);
});

test('a script that a card names and that is not a file inside the Lore is reported', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/contracts/no-script.md': contract('no-script', 'lore/contracts/no-script.py'),
    'lore/contracts/outside.md': contract('outside', 'lore/../outside.py'),
    'outside.py': 'import sys\n',
  });
  const lore = await read(space);
  for (const name of ['no-script', 'outside']) {
    const entry = findLoreEntry(lore, 'contracts', name);
    assert.equal(entry?.script, null, name);
    assert.notEqual(entry?.card.check, null, name);
    const found = problemsAt(
      lore,
      join(space, 'lore', 'contracts', `${name}.md`),
      'script-missing',
    );
    assert.equal(found.length, 1, name);
    assert.match(found[0]?.message ?? '', /the key check names ".*", which is not a file inside/);
  }
  assert.equal(lore.problems.length, 2);
});

// ---------- indexes ----------

test('an index that omits a child, lists what is not there, or has a line out of form is reported', async (t) => {
  const verbsIndex = [
    '---',
    'type: index',
    '---',
    '',
    '# Verbs',
    '',
    '- [core/](./core/index.md): the authoring verbs.',
    '- [gone/](./gone/index.md): a folder that is not there.',
    '- [gone.md](./gone.md): a file that is not there.',
    '- [plan-review.md](./plan-review.md): reviews the plan.',
    '- [plan-review.md](./plan-review.md): listed a second time.',
    '- plan-close.md is for closing.',
  ].join('\n');
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/index.md': verbsIndex,
    'lore/verbs/plan-review.md': verb('plan-review'),
    'lore/verbs/plan-close.md': verb('plan-close'),
    'lore/corpus/index.md':
      '---\ntype: index\nname: corpus\n---\n\n- [core/](./core/index.md): entries.\n',
  });
  const lore = await read(space);
  const indexPath = join(space, 'lore', 'verbs', 'index.md');
  const at = (kind: LoreProblemKind): string[] =>
    problemsAt(lore, indexPath, kind).map((problem) => problem.message);

  assert.deepEqual(at('index-omits'), [
    'the index has no line for the file plan-close.md',
    'the index has no line for the folder default',
  ]);
  assert.deepEqual(at('index-over-lists'), [
    'the index lists the file gone.md, which is not in the folder',
    'the index lists the folder gone, which is not in the folder',
  ]);
  assert.deepEqual(at('index-duplicate'), [
    'the index lists the file plan-review.md more than once',
  ]);
  assert.deepEqual(at('index-line'), [
    'this line does not have the form of an index line: - plan-close.md is for closing.',
  ]);
  assert.equal(
    problemsAt(lore, join(space, 'lore', 'corpus', 'index.md'), 'frontmatter').length,
    1,
  );
  assert.equal(lore.problems.length, 7);

  // The cards are still read. The first sentence is the description; a card with no line has none.
  assert.equal(findLoreEntry(lore, 'verbs', 'plan-review')?.description, 'reviews the plan.');
  assert.equal(findLoreEntry(lore, 'verbs', 'plan-close')?.description, null);
  assert.equal(findLoreEntry(lore, 'verbs', 'spec-draft')?.layer, 'default');
});

test('a folder with no index and a missing part are reported', async (t) => {
  const {
    'lore/mirrors/publish.md': _m,
    'lore/mirrors/generators/folder-skeleton.py': _g,
    ...rest
  } = wellFormedLore();
  const space = buildSpace(t, rest);
  mkdirSync(join(space, 'lore', 'verbs', 'notes'));
  const lore = await read(space);

  assert.deepEqual(lore.parts.mirrors, []);
  assert.deepEqual(problemsAt(lore, join(space, 'lore', 'mirrors'), 'part-missing'), [
    {
      kind: 'part-missing',
      path: join(space, 'lore', 'mirrors'),
      message: 'the Lore has no folder lore/mirrors/',
    },
  ]);
  assert.deepEqual(problemsAt(lore, join(space, 'lore', 'verbs', 'notes'), 'index-missing'), [
    {
      kind: 'index-missing',
      path: join(space, 'lore', 'verbs', 'notes'),
      message: 'the folder has no index.md',
    },
  ]);
  assert.equal(names(lore.parts.verbs).length, 3);
});

// ---------- symbolic links ----------

test('a symbolic link out of the Lore folder is reported and never followed', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'outside/plan-review.md': verb('plan-review'),
    'outside/folder/plan-close.md': verb('plan-close'),
    'lore/verbs/default/work-report.md': verb('work-report'),
  });
  const verbs = join(space, 'lore', 'verbs');
  symlinkSync(join(space, 'outside', 'plan-review.md'), join(verbs, 'plan-review.md'));
  symlinkSync(join(space, 'outside', 'folder'), join(verbs, 'linked'));
  symlinkSync(join(verbs, 'default'), join(verbs, 'again'));
  symlinkSync(join(space, 'nowhere.md'), join(verbs, 'plan-gone.md'));
  // A link to a file inside the Lore is read: work-report becomes an own card.
  symlinkSync(join(verbs, 'default', 'work-report.md'), join(verbs, 'work-report.md'));
  const lore = await read(space);

  assert.deepEqual(names(lore.parts.verbs), [
    'session-close',
    'spec-draft',
    'verb-add',
    'work-report',
  ]);
  assert.equal(findLoreEntry(lore, 'verbs', 'work-report')?.layer, 'own');
  for (const entry of [...lore.parts.verbs, ...lore.replaced]) {
    assert.ok(entry.path.startsWith(join(space, 'lore') + sep), entry.path);
  }

  const message = (name: string): string =>
    problemsAt(lore, join(verbs, name), 'symlink')[0]?.message ?? '';
  assert.match(message('plan-review.md'), /points outside the Lore folder and was not followed/);
  assert.match(message('linked'), /points outside the Lore folder and was not followed/);
  assert.match(message('again'), /points to a folder and was not followed/);
  assert.match(message('plan-gone.md'), /cannot be resolved/);
});

// ---------- no Lore to read ----------

test('readLore fails, without throwing, when there is no Lore folder to read', async (t) => {
  const space = useTempDir(t, 'ai-lore-lore-');
  const missing = await readLore(space);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.kind, 'lore-missing');
    assert.match(missing.error.message, /does not exist/);
  }

  writeFileSync(join(space, 'lore'), 'a file');
  const aFile = await readLore(space);
  assert.equal(!aFile.ok && aFile.error.kind, 'lore-not-a-folder');

  const linked = useTempDir(t, 'ai-lore-lore-');
  const real = buildSpace(t, wellFormedLore());
  symlinkSync(join(real, 'lore'), join(linked, 'lore'));
  const aLink = await readLore(linked);
  assert.equal(!aLink.ok && aLink.error.kind, 'lore-not-a-folder');
});

// ---------- attacks on layer resolution, and size ----------

test('an own card that parses and does not fit its kind does not replace its default', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    // The frontmatter is inside the subset; the mode is not one of the two.
    'lore/verbs/spec-draft.md': verb('spec-draft', 'sometimes'),
  });
  const lore = await read(space);
  const used = findLoreEntry(lore, 'verbs', 'spec-draft');
  assert.equal(used?.layer, 'default');
  assert.equal(used?.card.mode, 'read-only');
  assert.deepEqual(lore.replaced, []);
  assert.equal(problemsAt(lore, join(space, 'lore', 'verbs', 'spec-draft.md'), 'card').length, 1);
});

test('a core name is taken whatever the case of the letters, as the check script compares names', async (t) => {
  const space = buildSpace(t, {
    ...wellFormedLore(),
    'lore/verbs/Verb-Add.md': verb('verb-add'),
    'lore/contracts/default/WRITE-GUARD.py': 'import os\n',
  });
  const lore = await read(space);
  const taken = lore.problems.filter((problem) => problem.kind === 'core-name-taken');
  assert.deepEqual(taken.map((problem) => problem.path).sort(), [
    join(space, 'lore', 'contracts', 'default', 'WRITE-GUARD.py'),
    join(space, 'lore', 'verbs', 'Verb-Add.md'),
  ]);
  assert.equal(findLoreEntry(lore, 'verbs', 'verb-add')?.layer, 'core');
});

test('a file far larger than a card is reported and not taken into memory', async (t) => {
  const space = buildSpace(t, wellFormedLore());
  const path = join(space, 'lore', 'verbs', 'default', 'spec-draft.md');
  truncateSync(path, 50 * 1024 * 1024);
  const started = Date.now();
  const lore = await read(space);
  assert.ok(Date.now() - started < 1000);
  assert.equal(findLoreEntry(lore, 'verbs', 'spec-draft'), null);
  const found = problemsAt(lore, path, 'unreadable');
  assert.equal(found.length, 1);
  assert.match(found[0]?.message ?? '', /52428800 bytes/);
});

test('a Lore with 2,000 cards is read in a few seconds, with every index sentence attached', async (t) => {
  const files = wellFormedLore();
  for (let index = 0; index < 1000; index += 1) {
    files[`lore/verbs/default/item-v${index}.md`] = verb(`item-v${index}`);
    files[`lore/corpus/term${index}.md`] = corpus(`term${index}`);
  }
  const space = buildSpace(t, files);
  const before = treeHash(space);
  const started = Date.now();
  const lore = await read(space);
  const elapsed = Date.now() - started;
  assert.deepEqual(lore.problems, []);
  assert.equal(lore.parts.verbs.length, 1003);
  assert.equal(lore.parts.corpus.length, 1001);
  assert.equal(
    lore.parts.verbs.every((entry) => entry.description === sentenceFor(`${entry.name}.md`)),
    true,
  );
  assert.ok(elapsed < 5000, `reading 2,000 cards took ${elapsed} ms`);
  assert.equal(treeHash(space), before);
});

// ---------- the real template ----------

test('readLore reads the template of packages/spec/lore-1.0 in place', async () => {
  const template = loreTemplateDir();
  const lore = await read(template);

  // What phase M1.1 fixed: the tree, and the entries "card" and "frontmatter".
  for (const name of ['card', 'frontmatter']) {
    const entry = findLoreEntry(lore, 'corpus', name);
    assert.ok(entry, `the corpus entry ${name} was not read`);
    assert.equal(entry.layer, 'core');
    assert.equal(entry.card.term, name);
    assert.equal(entry.path, join(template, 'lore', 'corpus', 'core', `${name}.md`));
    assert.ok(entry.description !== null && entry.description.length > 0, 'the index sentence');
  }
  assert.ok(findLoreEntry(lore, 'corpus', 'card')?.card.pointsAt.includes('lore/verbs/index.md'));

  const structural: LoreProblemKind[] = ['part-missing', 'core-name-taken', 'symlink'];
  assert.deepEqual(
    lore.problems.filter((problem) => structural.includes(problem.kind)),
    [],
  );
  const loreDir = join(template, 'lore');
  for (const problem of lore.problems) {
    assert.ok(problem.path.startsWith(loreDir), problem.path);
    assert.ok(problem.message.length > 0);
  }
  const all = [
    ...lore.parts.corpus,
    ...lore.parts.verbs,
    ...lore.parts.processes,
    ...lore.parts.contracts,
    ...lore.parts.mirrors,
  ];
  for (const entry of all) {
    const folder = dirname(entry.path);
    const partDir = join(loreDir, entry.part);
    const expected = entry.layer === 'own' ? partDir : join(partDir, entry.layer);
    assert.equal(folder, expected, entry.path);
    assert.equal(entry.replacesDefault, false, entry.path);
  }
  assert.deepEqual(lore.replaced, []);
});
