/**
 * Unit tests of the install into Claude Code: the skill's name, description
 * and text, the paths, and the projection as a pure function of a resolved
 * Lore built by hand. Nothing here reads or writes a file.
 */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import {
  CLAUDE_CODE_INSTALL_FOLDER,
  CLAUDE_CODE_INSTALL_LAYOUT,
  CLAUDE_CODE_PLUGIN_PREFIX,
  type ContractCard,
  type LoreEntry,
  type LoreLayer,
  type ProcessCard,
  type ResolvedLore,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type VerbCard,
  checkSkillName,
  claudeCodeCheckPath,
  claudeCodeInstallPaths,
  claudeCodeSkillPath,
  projectClaudeCode,
  renderSkillFile,
  safeSkillDescription,
} from '../../src/space/index.js';

const SPACE = join('/', 'tmp', 'a-space');
const LORE = join(SPACE, 'lore');

function verbEntry(
  name: string,
  layer: LoreLayer = 'default',
  description: string | null = `use ${name} when asked.`,
): LoreEntry<VerbCard> {
  const folder = layer === 'own' ? [] : [layer];
  return {
    card: { kind: 'verb', name, pillar: 'working', mode: 'read-only', invokedBy: ['human-lead'] },
    part: 'verbs',
    layer,
    name,
    path: join(LORE, 'verbs', ...folder, `${name}.md`),
    description,
    replacesDefault: false,
    script: null,
  };
}

function processEntry(name: string, layer: LoreLayer = 'default'): LoreEntry<ProcessCard> {
  const folder = layer === 'own' ? [] : [layer];
  return {
    card: { kind: 'process', name, pillar: 'working', steps: ['a'], gates: [], unattended: false },
    part: 'processes',
    layer,
    name,
    path: join(LORE, 'processes', ...folder, `${name}.md`),
    description: `start ${name} when asked.`,
    replacesDefault: false,
    script: null,
  };
}

function contractEntry(
  name: string,
  script: string | null,
  layer: LoreLayer = 'core',
  check: string | null = script === null ? null : `lore/contracts/${name}.py`,
): LoreEntry<ContractCard> {
  const folder = layer === 'own' ? [] : [layer];
  return {
    card: {
      kind: 'contract',
      name,
      pillar: 'working',
      target: 'everything',
      payload: null,
      check,
      when: check === null ? null : 'before',
    },
    part: 'contracts',
    layer,
    name,
    path: join(LORE, 'contracts', ...folder, `${name}.md`),
    description: `the contract ${name}.`,
    replacesDefault: false,
    script,
  };
}

function lore(parts: Partial<ResolvedLore['parts']>, problems: ResolvedLore['problems'] = []) {
  const resolved: ResolvedLore = {
    spaceRoot: SPACE,
    loreDir: LORE,
    parts: { corpus: [], verbs: [], processes: [], contracts: [], mirrors: [], ...parts },
    replaced: [],
    problems,
  };
  return resolved;
}

function frontmatterOf(skillText: string): unknown {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skillText);
  assert.ok(match, 'the skill file begins with a frontmatter');
  return loadYaml(match[1] ?? '');
}

// ---------- the skill's name ----------

test('checkSkillName accepts lower-case words joined by hyphens', () => {
  for (const name of ['work', 'spec-draft', 'a1-b2-c3', 'x'.repeat(SKILL_NAME_MAX_LENGTH)]) {
    assert.deepEqual(checkSkillName(name), { ok: true, value: name });
  }
});

test('checkSkillName refuses what cannot be a skill name or could leave the skills folder', () => {
  const refused = [
    '',
    'x'.repeat(SKILL_NAME_MAX_LENGTH + 1),
    'Spec-Draft',
    'spec_draft',
    'spec draft',
    '-spec',
    'spec-',
    'spec--draft',
    '..',
    '../evil',
    'a/b',
    'a\\b',
    'a.b',
    'spec\ndraft',
    'my-claude-verb',
    'anthropic-helper',
  ];
  for (const name of refused) {
    const result = checkSkillName(name);
    assert.equal(result.ok, false, `"${name}" is refused`);
    if (!result.ok) {
      assert.equal(result.error.kind, 'unsafe-name');
      assert.ok(!/[\n\r]/.test(result.error.message), 'the message is one line');
    }
  }
});

// ---------- the skill's description ----------

test('safeSkillDescription leaves a plain sentence as it is', () => {
  const text = 'use when the Human Lead asks: it writes "nothing", and says so.';
  assert.deepEqual(safeSkillDescription(text), { ok: true, value: { text, changed: false } });
});

test('safeSkillDescription puts the text on one line and removes control characters and angle brackets', () => {
  // A NUL and a line separator, built from their codes so that this file holds neither.
  const odd = `${String.fromCharCode(0)} ${String.fromCharCode(0x2028)}`;
  const result = safeSkillDescription(`  use <name>\twhen\r\nasked${odd}now  `);
  assert.deepEqual(result, { ok: true, value: { text: 'use name when asked now', changed: true } });
});

test('safeSkillDescription cuts a long text at a space, within the limit', () => {
  const result = safeSkillDescription('word '.repeat(400));
  assert.ok(result.ok);
  assert.equal(result.value.changed, true);
  assert.ok(result.value.text.length <= SKILL_DESCRIPTION_MAX_LENGTH);
  assert.ok(result.value.text.endsWith('word...'));
  const unbroken = safeSkillDescription('x'.repeat(3000));
  assert.ok(unbroken.ok);
  assert.equal(unbroken.value.text.length, SKILL_DESCRIPTION_MAX_LENGTH);
});

test('safeSkillDescription never cuts inside a character, and keeps the joiner inside an emoji', () => {
  // Built from their codes so that this file holds no character outside ASCII.
  const face = String.fromCodePoint(0x1f600);
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (const text of [face.repeat(2500), `a${face.repeat(2500)}`]) {
    const result = safeSkillDescription(text);
    assert.ok(result.ok);
    assert.ok(result.value.text.length <= SKILL_DESCRIPTION_MAX_LENGTH);
    assert.equal(loneSurrogate.test(result.value.text), false, 'no half of a character is left');
    assert.ok(result.value.text.endsWith(`${face}...`));
  }

  const joiner = String.fromCodePoint(0x200d);
  const family = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(joiner);
  const kept = safeSkillDescription(`a family ${family} here`);
  assert.deepEqual(kept, {
    ok: true,
    value: { text: `a family ${family} here`, changed: false },
  });
  const hidden = safeSkillDescription(`in${joiner}visible`);
  assert.deepEqual(hidden, { ok: true, value: { text: 'in visible', changed: true } });
});

test('renderSkillFile gives one line per field for text that looks like YAML, and js-yaml reads it back', () => {
  const newline = String.fromCharCode(10);
  const source = {
    name: 'spec-draft',
    cardKind: 'verb' as const,
    cardPath: join(LORE, 'verbs', 'default', 'spec-draft.md'),
    cardRelativePath: 'lore/verbs/default/spec-draft.md',
  };
  const hostile = [
    '---',
    ['text', '---', 'name: evil', '---', 'more'].join(newline),
    ['name: evil', 'description: evil'].join(newline),
    ['line one', 'line two', ''].join(`${String.fromCharCode(13)}${newline}`),
    '%YAML 1.2',
    'yes',
    '"quoted"',
    "'quoted'",
    '| literal',
    `family ${String.fromCodePoint(0x1f468, 0x200d, 0x1f469)} ${String.fromCodePoint(0x2714, 0xfe0f)}`,
    'word: '.repeat(1000),
  ];
  for (const given of hostile) {
    const description = safeSkillDescription(given);
    assert.ok(description.ok, given);
    const text = renderSkillFile({ ...source, description: description.value.text });
    assert.ok(text.ok, given);
    assert.equal(text.value.includes(String.fromCharCode(13)), false);
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text.value);
    assert.ok(match);
    const frontmatter = match[1] ?? '';
    assert.equal(frontmatter.split('\n').length, 2, `two lines for: ${given}`);
    assert.deepEqual(loadYaml(frontmatter), {
      name: source.name,
      description: description.value.text,
    });
  }
});

test('safeSkillDescription refuses text that is empty once it is cleaned', () => {
  for (const text of ['', '   ', '<>', '\n\t']) {
    const result = safeSkillDescription(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'no-description');
  }
});

// ---------- the skill's text ----------

const DESCRIPTIONS = [
  'a plain sentence.',
  'use when: the item is "ready", or the Human Lead says \'go\'.',
  'a # that is not a comment, and a back\\slash',
  '- begins like a list item',
  '[begins] like a flow list, {and} a map',
  '& anchor, * alias, ! tag, | block, > fold, % directive, @ at, ` tick',
  'true',
  'null',
  '12345',
  '~',
  'key: value: again',
  'ends with a colon:',
  'unicode: é ñ — “curly” 日本語',
];

test('renderSkillFile writes a frontmatter that js-yaml reads back exactly', () => {
  for (const description of DESCRIPTIONS) {
    const text = renderSkillFile({
      name: 'spec-draft',
      description,
      cardKind: 'verb',
      cardPath: join(LORE, 'verbs', 'default', 'spec-draft.md'),
      cardRelativePath: 'lore/verbs/default/spec-draft.md',
    });
    assert.ok(text.ok, `"${description}" is written`);
    assert.deepEqual(frontmatterOf(text.value), { name: 'spec-draft', description });
  }
});

test('renderSkillFile points at the card and does not copy it', () => {
  const cardPath = join(LORE, 'processes', 'default', 'work.md');
  const text = renderSkillFile({
    name: 'work',
    description: 'start this process when one item is to be built.',
    cardKind: 'process',
    cardPath,
    cardRelativePath: 'lore/processes/default/work.md',
  });
  assert.ok(text.ok);
  assert.ok(text.value.includes(cardPath));
  assert.ok(text.value.includes('`lore/processes/default/work.md`'));
  assert.ok(text.value.includes('the process work'));
  assert.ok(text.value.endsWith('\n'));
});

test('renderSkillFile refuses a description the frontmatter cannot hold', () => {
  const text = renderSkillFile({
    name: 'work',
    description: 'two\nlines',
    cardKind: 'process',
    cardPath: '/x/work.md',
    cardRelativePath: 'lore/processes/work.md',
  });
  assert.equal(text.ok, false);
  if (!text.ok) assert.equal(text.error.kind, 'frontmatter-unsafe');
});

// ---------- the paths ----------

test('claudeCodeInstallPaths places everything under install/claude-code', () => {
  const installDir = join('/', 'data', 'spaces', 'key', 'install');
  const paths = claudeCodeInstallPaths(installDir);
  const dir = join(installDir, CLAUDE_CODE_INSTALL_FOLDER);
  assert.deepEqual(paths, {
    dir,
    plugin: join(dir, 'plugin'),
    pluginManifest: join(dir, 'plugin', '.claude-plugin', 'plugin.json'),
    skills: join(dir, 'plugin', 'skills'),
    checks: join(dir, 'checks'),
    record: join(dir, 'install.json'),
  });
});

test('claudeCodeSkillPath and claudeCodeCheckPath give paths relative to the install folder', () => {
  assert.equal(claudeCodeSkillPath('spec-draft'), 'plugin/skills/spec-draft/SKILL.md');
  assert.equal(
    claudeCodeCheckPath(join(LORE, 'contracts', 'core', 'write-guard.py')),
    'checks/write-guard.py',
  );
});

// ---------- the projection ----------

test('projectClaudeCode gives the plugin manifest, one skill per verb and process, and one check per script', () => {
  const script = join(LORE, 'contracts', 'core', 'write-guard.py');
  const projection = projectClaudeCode(
    lore({
      verbs: [verbEntry('spec-draft'), verbEntry('verb-add', 'core')],
      processes: [processEntry('work')],
      contracts: [contractEntry('write-guard', script), contractEntry('stage-gate', null)],
    }),
  );
  assert.deepEqual(projection.reports, []);
  assert.deepEqual(
    projection.files.map((file) => [file.path, file.kind]),
    [
      ['checks/write-guard.py', 'check'],
      ['plugin/.claude-plugin/plugin.json', 'plugin-manifest'],
      ['plugin/skills/spec-draft/SKILL.md', 'skill'],
      ['plugin/skills/verb-add/SKILL.md', 'skill'],
      ['plugin/skills/work/SKILL.md', 'skill'],
    ],
  );
  const manifest = projection.files.find((file) => file.kind === 'plugin-manifest');
  assert.equal(JSON.parse(manifest?.content ?? '{}').name, CLAUDE_CODE_PLUGIN_PREFIX);
  const check = projection.files.find((file) => file.kind === 'check');
  assert.equal(check?.content, null);
  assert.equal(check?.copyFrom, script);
  assert.deepEqual(check?.cards, [
    {
      part: 'contracts',
      name: 'write-guard',
      layer: 'core',
      path: 'lore/contracts/core/write-guard.md',
      replacesDefault: false,
      when: 'before',
    },
  ]);
  const skill = projection.files.find((file) => file.path === claudeCodeSkillPath('spec-draft'));
  assert.deepEqual(frontmatterOf(skill?.content ?? ''), {
    name: 'spec-draft',
    description: 'use spec-draft when asked.',
  });
});

test('projectClaudeCode projects no hook and no settings file', () => {
  const projection = projectClaudeCode(
    lore({
      verbs: [verbEntry('spec-draft')],
      contracts: [contractEntry('write-guard', join(LORE, 'contracts', 'core', 'write-guard.py'))],
    }),
  );
  for (const file of projection.files) {
    assert.ok(!/hook|settings/i.test(file.path), `${file.path} is not a hook or a settings file`);
    if (file.kind === 'plugin-manifest') {
      const manifest = JSON.parse(file.content ?? '{}');
      assert.deepEqual(Object.keys(manifest).sort(), ['author', 'description', 'name', 'version']);
      assert.deepEqual(Object.keys(manifest.author), ['name']);
    }
  }
  assert.ok(!Object.values(CLAUDE_CODE_INSTALL_LAYOUT).some((path) => /hook/i.test(path)));
});

test('projectClaudeCode points the skill at the own card that replaces a default', () => {
  const own: LoreEntry<VerbCard> = { ...verbEntry('spec-draft', 'own'), replacesDefault: true };
  const projection = projectClaudeCode(lore({ verbs: [own] }));
  const skill = projection.files.find((file) => file.kind === 'skill');
  assert.equal(skill?.cards[0]?.path, 'lore/verbs/spec-draft.md');
  assert.equal(skill?.cards[0]?.layer, 'own');
  assert.equal(skill?.cards[0]?.replacesDefault, true);
  assert.ok(skill?.content?.includes('`lore/verbs/spec-draft.md`'));
});

test('projectClaudeCode reports a name that a verb and a process share, and installs neither', () => {
  const projection = projectClaudeCode(
    lore({
      verbs: [verbEntry('work'), verbEntry('spec-draft')],
      processes: [processEntry('work')],
    }),
  );
  assert.deepEqual(
    projection.files.filter((file) => file.kind === 'skill').map((file) => file.path),
    ['plugin/skills/spec-draft/SKILL.md'],
  );
  const collisions = projection.reports.filter((report) => report.kind === 'name-collision');
  assert.deepEqual(collisions.map((report) => report.path).sort(), [
    join(LORE, 'processes', 'default', 'work.md'),
    join(LORE, 'verbs', 'default', 'work.md'),
  ]);
});

test('projectClaudeCode keeps the core card when another card takes its name', () => {
  const projection = projectClaudeCode(
    lore({ verbs: [verbEntry('verb-add', 'core')], processes: [processEntry('verb-add', 'own')] }),
  );
  const skills = projection.files.filter((file) => file.kind === 'skill');
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.cards[0]?.path, 'lore/verbs/core/verb-add.md');
  assert.deepEqual(
    projection.reports.map((report) => [report.kind, report.path]),
    [['name-collision', join(LORE, 'processes', 'verb-add.md')]],
  );
});

test('projectClaudeCode does not install a card with an unsafe name or without a description', () => {
  const projection = projectClaudeCode(
    lore({
      verbs: [
        verbEntry('../evil'),
        verbEntry('a/b'),
        verbEntry('..'),
        verbEntry('no-line', 'own', null),
        verbEntry('empty-line', 'own', '  <> '),
      ],
    }),
  );
  assert.deepEqual(
    projection.files.map((file) => file.kind),
    ['plugin-manifest'],
  );
  assert.deepEqual(
    projection.reports.map((report) => report.kind),
    ['unsafe-name', 'unsafe-name', 'unsafe-name', 'no-description', 'no-description'],
  );
  for (const file of projection.files) assert.ok(!file.path.includes('..'));
});

test('projectClaudeCode installs a skill whose description had to change, and says so', () => {
  const projection = projectClaudeCode(
    lore({ verbs: [verbEntry('long-one', 'own', `use <this> ${'very '.repeat(400)}often.`)] }),
  );
  const skill = projection.files.find((file) => file.kind === 'skill');
  const frontmatter = frontmatterOf(skill?.content ?? '') as { description: string };
  assert.ok(frontmatter.description.length <= SKILL_DESCRIPTION_MAX_LENGTH);
  assert.ok(frontmatter.description.startsWith('use this very'));
  assert.deepEqual(
    projection.reports.map((report) => report.kind),
    ['description-changed'],
  );
});

test('projectClaudeCode reports the cards the reader did not use, and no other problem', () => {
  const broken = join(LORE, 'verbs', 'broken-one.md');
  const projection = projectClaudeCode(
    lore({ verbs: [verbEntry('spec-draft')] }, [
      { kind: 'frontmatter', path: broken, message: 'line 3: not in the subset' },
      { kind: 'core-name-taken', path: join(LORE, 'processes', 'x.md'), message: 'taken' },
      { kind: 'card', path: join(LORE, 'corpus', 'term.md'), message: 'not a verb or a process' },
      { kind: 'frontmatter', path: join(LORE, 'verbs', 'index.md'), message: 'an index' },
      { kind: 'index-omits', path: join(LORE, 'verbs', 'index.md'), message: 'no line' },
    ]),
  );
  assert.deepEqual(
    projection.reports.map((report) => [report.kind, report.path]),
    [
      ['card-problem', broken],
      ['card-problem', join(LORE, 'processes', 'x.md')],
    ],
  );
  assert.equal(projection.files.filter((file) => file.kind === 'skill').length, 1);
});

test('projectClaudeCode reports a missing check script, an unsafe file name and a file name taken twice', () => {
  const core = join(LORE, 'contracts', 'core', 'write-guard.py');
  const projection = projectClaudeCode(
    lore({
      contracts: [
        contractEntry('aaa-own-guard', join(LORE, 'contracts', 'write-guard.py'), 'own'),
        contractEntry('gone', null, 'own', 'lore/contracts/gone.py'),
        // Not joined: `join` would remove the `..` that this test is about.
        contractEntry('odd-name', `${LORE}/contracts/..`, 'own'),
        contractEntry('spaced', join(LORE, 'contracts', 'my check.py'), 'own'),
        contractEntry('shares-core', core, 'own'),
        contractEntry('write-guard', core),
      ],
    }),
  );
  const checks = projection.files.filter((file) => file.kind === 'check');
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.copyFrom, core, 'the core script keeps its file name');
  assert.deepEqual(
    checks[0]?.cards.map((card) => card.name),
    ['write-guard', 'shares-core'],
  );
  assert.deepEqual(projection.reports.map((report) => report.kind).sort(), [
    'check-name-collision',
    'script-missing',
    'unsafe-check-name',
    'unsafe-check-name',
  ]);
});
