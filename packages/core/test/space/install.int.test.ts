/**
 * Integration tests of the install into Claude Code: the real Lore template,
 * scaffolded into a temporary Space by `makeSpaceFixture`, installed into a
 * temporary folder that stands for a desk's `install` folder. Nothing is
 * written outside the temporary folder, and never into a `.claude/` folder.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import {
  type InstallOutcome,
  type InstallPlan,
  type InstallRecord,
  type ResolvedLore,
  claudeCodeInstallPaths,
  installClaudeCode,
  planClaudeCodeInstall,
  readInstallRecord,
  readLore,
} from '../../src/space/index.js';
import { type SpaceFixture, makeSpaceFixture } from '../../src/space/testing/index.js';
import { loreTemplateDir } from '../support/paths.js';
import { type CleanupHost, useTempDir } from '../support/temp.js';

// ---------- helpers ----------

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every file under `dir`, relative to it, with `/`, sorted. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (folder: string): void => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, item.name);
      if (item.isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

async function useSpace(t: CleanupHost): Promise<SpaceFixture> {
  const fixture = await makeSpaceFixture({ templateDir: loreTemplateDir() });
  t.after(() => fixture.cleanup());
  return fixture;
}

async function lore(space: SpaceFixture): Promise<ResolvedLore> {
  const result = await readLore(space.root);
  assert.ok(result.ok, 'the Lore is read');
  return result.value;
}

async function install(
  space: SpaceFixture,
  installDir: string,
  options: Parameters<typeof installClaudeCode>[2] = {},
): Promise<InstallOutcome> {
  const result = await installClaudeCode(await lore(space), installDir, options);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  return result.value;
}

function frontmatterOf(path: string): { name: string; description: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, 'utf8'));
  assert.ok(match, `${path} begins with a frontmatter`);
  return loadYaml(match[1] ?? '') as { name: string; description: string };
}

const verbText = (name: string): string =>
  [
    '---',
    'type: verb',
    `name: ${name}`,
    'pillar: working',
    'mode: read-only',
    'invoked_by:',
    '  - human-lead',
    '---',
    '',
    `# ${name}`,
    '',
    'Prose.',
    '',
  ].join('\n');

/** Add an own verb to the fixture's Lore, with its line in the index of `lore/verbs/`. */
function addOwnVerb(space: SpaceFixture, name: string, sentence: string | null): void {
  writeFileSync(join(space.paths.lore, 'verbs', `${name}.md`), verbText(name), 'utf8');
  if (sentence !== null) {
    appendFileSync(
      join(space.paths.lore, 'verbs', 'index.md'),
      `- [${name}.md](./${name}.md): ${sentence}\n`,
      'utf8',
    );
  }
}

function removeOwnVerb(space: SpaceFixture, name: string): void {
  rmSync(join(space.paths.lore, 'verbs', `${name}.md`));
  const indexPath = join(space.paths.lore, 'verbs', 'index.md');
  const lines = readFileSync(indexPath, 'utf8').split('\n');
  writeFileSync(
    indexPath,
    lines.filter((line) => !line.startsWith(`- [${name}.md]`)).join('\n'),
    'utf8',
  );
}

const actionsOf = (plan: InstallPlan, action: string): string[] =>
  plan.actions.filter((item) => item.action === action).map((item) => item.path);

// ---------- the first install ----------

test('install projects the template: one skill per verb and process, the checks unchanged, install.json, no hook', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const resolved = await lore(space);
  assert.deepEqual(resolved.problems, [], 'the template has no problem');

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.equal(outcome.applied, true);
  assert.deepEqual(outcome.plan.reports, []);

  const cards = [...resolved.parts.verbs, ...resolved.parts.processes];
  assert.ok(cards.length >= 15, 'the template has the core and default verbs and processes');
  const scripts = resolved.parts.contracts.flatMap((entry) => entry.script ?? []);
  assert.equal(scripts.length, 3);

  const expected = [
    ...scripts.map((script) => `checks/${script.split(sep).pop()}`),
    'install.json',
    'plugin/.claude-plugin/plugin.json',
    ...cards.map((entry) => `plugin/skills/${entry.name}/SKILL.md`),
  ].sort();
  assert.deepEqual(filesUnder(paths.dir), expected, 'exactly these files, and no hook or settings');
  assert.deepEqual(
    filesUnder(installDir),
    expected.map((path) => `claude-code/${path}`),
  );
  assert.deepEqual([...outcome.written].sort(), expected);

  for (const entry of cards) {
    const skill = join(paths.skills, entry.name, 'SKILL.md');
    assert.deepEqual(frontmatterOf(skill), { name: entry.name, description: entry.description });
    assert.ok(readFileSync(skill, 'utf8').includes(entry.path), 'the skill points at the card');
  }
  for (const script of scripts) {
    const copy = join(paths.checks, script.split(sep).pop() ?? '');
    assert.equal(sha256(copy), sha256(script), 'the check script is copied unchanged');
    assert.deepEqual(readFileSync(copy), readFileSync(script));
  }
  assert.equal(JSON.parse(readFileSync(paths.pluginManifest, 'utf8')).name, 'lore');

  const record = await readInstallRecord(paths.dir);
  assert.ok(record.ok && record.value !== null);
  assert.deepEqual(record.value, outcome.plan.record);
  assert.equal(record.value.engine, 'claude-code');
  assert.equal(record.value.prefix, 'lore');
  assert.equal(record.value.space, space.root);
  assert.deepEqual(
    record.value.files.map((file) => file.path),
    expected.filter((path) => path !== 'install.json'),
  );
  for (const file of record.value.files) {
    assert.equal(file.sha256, sha256(join(paths.dir, file.path)), `${file.path} has its hash`);
    for (const card of file.cards) {
      assert.equal(card.sha256, sha256(join(space.root, card.path)), `${card.path} has its hash`);
    }
    assert.equal(file.cards.length, file.kind === 'plugin-manifest' ? 0 : 1);
  }
  const guard = record.value.files.find((file) => file.path === 'checks/write-guard.py');
  assert.equal(guard?.cards[0]?.name, 'write-guard');
  assert.equal(guard?.cards[0]?.when, 'before');

  assert.equal(await space.space.git('status', '--porcelain'), '', 'the Space is not written');
  assert.ok(!existsSync(join(space.root, '.claude')), 'no .claude folder in the Space');
});

test('readInstallRecord gives null where nothing was installed', async (t) => {
  const installDir = useTempDir(t, 'ai-lore-install-');
  assert.deepEqual(await readInstallRecord(claudeCodeInstallPaths(installDir).dir), {
    ok: true,
    value: null,
  });
});

// ---------- own cards ----------

test('an own card replaces the default of the same name, and its description is quoted correctly', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const sentence = 'use when: the Human Lead says "draft it", or \'go\' # not a comment.';
  addOwnVerb(space, 'spec-draft', sentence);

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const skill = join(paths.skills, 'spec-draft', 'SKILL.md');
  assert.deepEqual(frontmatterOf(skill), { name: 'spec-draft', description: sentence });
  const text = readFileSync(skill, 'utf8');
  assert.ok(text.includes('`lore/verbs/spec-draft.md`'));
  assert.ok(!text.includes('lore/verbs/default/spec-draft.md'));

  const file = outcome.plan.record.files.find(
    (item) => item.path === 'plugin/skills/spec-draft/SKILL.md',
  );
  assert.deepEqual(
    file?.cards.map((card) => [card.path, card.layer, card.replacesDefault]),
    [['lore/verbs/spec-draft.md', 'own', true]],
  );
  assert.equal(
    outcome.plan.record.files.filter((item) => item.path.includes('/spec-draft/')).length,
    1,
  );
});

test('a card with a problem is not installed and is reported', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  addOwnVerb(space, 'good-one', 'use when asked.');
  addOwnVerb(space, 'no-line', null);
  addOwnVerb(space, 'broken-one', 'use when asked.');
  const broken = join(space.paths.lore, 'verbs', 'broken-one.md');
  writeFileSync(broken, verbText('broken-one').replace('mode: read-only', 'mode: sometimes'));

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.ok(existsSync(join(paths.skills, 'good-one', 'SKILL.md')));
  assert.ok(!existsSync(join(paths.skills, 'no-line')));
  assert.ok(!existsSync(join(paths.skills, 'broken-one')));
  assert.deepEqual(outcome.plan.reports.map((report) => [report.kind, report.path]).sort(), [
    ['card-problem', broken],
    ['no-description', join(space.paths.lore, 'verbs', 'no-line.md')],
  ]);
});

test('a contract whose check script is missing gets no copy and is reported', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  rmSync(join(space.paths.lore, 'contracts', 'core', 'write-guard.py'));

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.ok(!existsSync(join(paths.checks, 'write-guard.py')));
  assert.ok(existsSync(join(paths.checks, 'lore-integrity.py')));
  assert.deepEqual(
    outcome.plan.reports.map((report) => report.kind),
    ['script-missing'],
  );
});

// ---------- installing again ----------

test('a second install writes nothing and leaves the same install.json', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const first = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const recordBefore = readFileSync(paths.record, 'utf8');
  const stamps = filesUnder(paths.dir).map((path) => statSync(join(paths.dir, path)).mtimeMs);
  const inodes = filesUnder(paths.dir).map((path) => statSync(join(paths.dir, path)).ino);

  const second = await install(space, installDir);
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.removed, []);
  assert.equal(second.plan.recordChanges, false);
  assert.ok(second.plan.actions.every((item) => item.action === 'unchanged'));
  assert.deepEqual(second.plan.record, first.plan.record);
  assert.equal(readFileSync(paths.record, 'utf8'), recordBefore);
  assert.deepEqual(
    filesUnder(paths.dir).map((path) => statSync(join(paths.dir, path)).mtimeMs),
    stamps,
  );
  assert.deepEqual(
    filesUnder(paths.dir).map((path) => statSync(join(paths.dir, path)).ino),
    inodes,
    'no file was replaced',
  );
});

test('an install after a card was removed removes its skill and nothing it did not install', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  addOwnVerb(space, 'gone-soon', 'use when asked.');
  addOwnVerb(space, 'gone-too', 'use when asked.');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.ok(existsSync(join(paths.skills, 'gone-soon', 'SKILL.md')));

  // What the Human Lead made by hand: a skill, a note inside an installed skill's folder, a check.
  const handMade = join(paths.skills, 'hand-made', 'SKILL.md');
  mkdirSync(join(paths.skills, 'hand-made'));
  writeFileSync(handMade, '---\nname: hand-made\ndescription: mine\n---\n\nMine.\n');
  const note = join(paths.skills, 'gone-too', 'notes.md');
  writeFileSync(note, 'a note\n');
  const ownCheck = join(paths.checks, 'my-check.py');
  writeFileSync(ownCheck, 'print("mine")\n');

  removeOwnVerb(space, 'gone-soon');
  removeOwnVerb(space, 'gone-too');
  const outcome = await install(space, installDir);

  assert.deepEqual(outcome.removed.sort(), [
    'plugin/skills/gone-soon/SKILL.md',
    'plugin/skills/gone-too/SKILL.md',
  ]);
  assert.deepEqual(outcome.written, ['install.json']);
  assert.ok(!existsSync(join(paths.skills, 'gone-soon')), 'the empty skill folder is removed');
  assert.ok(!existsSync(join(paths.skills, 'gone-too', 'SKILL.md')));
  assert.equal(readFileSync(note, 'utf8'), 'a note\n', 'a file it did not install survives');
  assert.equal(readFileSync(ownCheck, 'utf8'), 'print("mine")\n');
  assert.ok(readFileSync(handMade, 'utf8').includes('Mine.'), 'the hand-made skill survives');
  assert.ok(existsSync(join(paths.skills, 'spec-draft', 'SKILL.md')));
  assert.ok(!outcome.plan.record.files.some((file) => file.path.includes('gone-')));
  assert.ok(!outcome.plan.record.files.some((file) => file.path.includes('hand-made')));
  assert.deepEqual(outcome.plan.reports, []);

  const again = await install(space, installDir);
  assert.deepEqual([again.written, again.removed], [[], []]);
});

test('a card renamed in the Lore moves its skill', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  addOwnVerb(space, 'old-name', 'use when asked.');
  await install(space, installDir);
  removeOwnVerb(space, 'old-name');
  addOwnVerb(space, 'new-name', 'use when asked.');

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.deepEqual(outcome.removed, ['plugin/skills/old-name/SKILL.md']);
  assert.deepEqual(outcome.written, ['plugin/skills/new-name/SKILL.md', 'install.json']);
  assert.ok(!existsSync(join(paths.skills, 'old-name')));
  assert.ok(existsSync(join(paths.skills, 'new-name', 'SKILL.md')));
});

test('a check script changed in the Lore is copied again, and a changed description rewrites the skill', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  addOwnVerb(space, 'my-verb', 'use when asked.');
  await install(space, installDir);
  const script = join(space.paths.lore, 'contracts', 'core', 'lore-integrity.py');
  appendFileSync(script, '\n# changed\n');
  const indexPath = join(space.paths.lore, 'verbs', 'index.md');
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8').replace(
      '(./my-verb.md): use when asked.',
      '(./my-verb.md): use on Mondays.',
    ),
  );

  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  assert.deepEqual(outcome.written, [
    'checks/lore-integrity.py',
    'plugin/skills/my-verb/SKILL.md',
    'install.json',
  ]);
  assert.equal(sha256(join(paths.checks, 'lore-integrity.py')), sha256(script));
  assert.equal(
    frontmatterOf(join(paths.skills, 'my-verb', 'SKILL.md')).description,
    'use on Mondays.',
  );
});

// ---------- files changed by hand ----------

test('a projected file edited by hand is detected by its hash, kept and reported', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  addOwnVerb(space, 'leaving-soon', 'use when asked.');
  const first = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const edited = join(paths.skills, 'spec-draft', 'SKILL.md');
  const editedCheck = join(paths.checks, 'write-guard.py');
  const leaving = join(paths.skills, 'leaving-soon', 'SKILL.md');
  for (const path of [edited, editedCheck, leaving]) appendFileSync(path, '\n# edited by hand\n');
  removeOwnVerb(space, 'leaving-soon');

  const outcome = await install(space, installDir);
  assert.deepEqual(actionsOf(outcome.plan, 'keep-edited'), [
    'checks/write-guard.py',
    'plugin/skills/leaving-soon/SKILL.md',
    'plugin/skills/spec-draft/SKILL.md',
  ]);
  assert.deepEqual(
    outcome.plan.reports.map((report) => [report.kind, report.path]).sort(),
    [
      ['edited-by-hand', editedCheck],
      ['edited-by-hand', leaving],
      ['edited-by-hand', edited],
    ].sort(),
  );
  assert.deepEqual(outcome.removed, []);
  for (const path of [edited, editedCheck, leaving]) {
    assert.ok(readFileSync(path, 'utf8').endsWith('# edited by hand\n'), `${path} is kept`);
  }
  // The record keeps the hash the install wrote, so the edit is reported at every install.
  const hashOf = (record: InstallRecord, path: string): string | undefined =>
    record.files.find((file) => file.path === path)?.sha256;
  for (const path of ['checks/write-guard.py', 'plugin/skills/leaving-soon/SKILL.md']) {
    assert.equal(hashOf(outcome.plan.record, path), hashOf(first.plan.record, path));
  }
  const again = await install(space, installDir);
  assert.equal(again.plan.reports.length, 3);
  assert.deepEqual(again.written, []);

  const forced = await install(space, installDir, { overwriteEdited: true });
  assert.deepEqual(forced.removed, ['plugin/skills/leaving-soon/SKILL.md']);
  assert.deepEqual(forced.plan.reports, []);
  assert.ok(forced.plan.actions.filter((item) => item.overwritesEdit).length === 3);
  assert.ok(!readFileSync(edited, 'utf8').includes('edited by hand'));
  assert.equal(
    sha256(editedCheck),
    sha256(join(space.paths.lore, 'contracts', 'core', 'write-guard.py')),
  );
  assert.ok(!existsSync(leaving));
});

test('a file that an install deleted by hand is written again', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  rmSync(join(paths.skills, 'work'), { recursive: true });

  const outcome = await install(space, installDir);
  assert.deepEqual(outcome.written, ['plugin/skills/work/SKILL.md']);
  assert.ok(existsSync(join(paths.skills, 'work', 'SKILL.md')));
});

test('a file the install did not write is never replaced, even with overwriteEdited', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const paths = claudeCodeInstallPaths(installDir);
  const foreign = join(paths.skills, 'work', 'SKILL.md');
  mkdirSync(join(paths.skills, 'work'), { recursive: true });
  writeFileSync(foreign, 'made by hand before any install\n');

  const outcome = await install(space, installDir, { overwriteEdited: true });
  assert.deepEqual(actionsOf(outcome.plan, 'keep-foreign'), ['plugin/skills/work/SKILL.md']);
  assert.deepEqual(
    outcome.plan.reports.map((report) => [report.kind, report.path]),
    [['not-installed-by-companion', foreign]],
  );
  assert.equal(readFileSync(foreign, 'utf8'), 'made by hand before any install\n');
  assert.ok(!outcome.plan.record.files.some((file) => file.path.includes('/work/')));
  assert.ok(existsSync(join(paths.skills, 'plan', 'SKILL.md')), 'the rest is installed');
});

test('an install.json that cannot be read is reported, and files with the projected content are taken over', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const first = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  writeFileSync(paths.record, '{ not json');
  const unreadable = await readInstallRecord(paths.dir);
  assert.equal(unreadable.ok, false);
  appendFileSync(join(paths.skills, 'plan', 'SKILL.md'), 'edited\n');

  const outcome = await install(space, installDir);
  assert.deepEqual(
    outcome.plan.reports.map((report) => report.kind),
    ['install-record-unreadable', 'not-installed-by-companion'],
  );
  assert.deepEqual(outcome.written, ['install.json']);
  assert.ok(readFileSync(join(paths.skills, 'plan', 'SKILL.md'), 'utf8').endsWith('edited\n'));
  assert.equal(outcome.plan.record.files.length, first.plan.record.files.length - 1);

  for (const text of [
    '[]',
    '{"version":2}',
    '{"version":1,"engine":"claude-code","prefix":"lore","space":"/x","files":[{"path":"a"}]}',
  ]) {
    writeFileSync(paths.record, text);
    assert.equal((await readInstallRecord(paths.dir)).ok, false, `${text} is not a record`);
  }
});

// ---------- the dry run ----------

test('a dry run returns the plan and writes nothing', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const dry = await install(space, installDir, { dryRun: true });
  assert.equal(dry.applied, false);
  assert.deepEqual([dry.written, dry.removed], [[], []]);
  assert.deepEqual(readdirSync(installDir), [], 'not even a folder was made');
  assert.ok(dry.plan.actions.length >= 19);
  assert.ok(dry.plan.actions.every((item) => item.action === 'write'));
  assert.equal(dry.plan.recordChanges, true);

  const planned = await planClaudeCodeInstall(await lore(space), installDir);
  assert.ok(planned.ok);
  assert.deepEqual(planned.value, dry.plan);
  assert.deepEqual(readdirSync(installDir), []);

  const real = await install(space, installDir);
  assert.deepEqual(real.plan, dry.plan, 'the install does what the dry run said');

  // A dry run of an install that would remove and keep.
  addOwnVerb(space, 'short-lived', 'use when asked.');
  await install(space, installDir);
  removeOwnVerb(space, 'short-lived');
  const paths = claudeCodeInstallPaths(installDir);
  appendFileSync(join(paths.skills, 'work', 'SKILL.md'), 'edited\n');
  const before = filesUnder(paths.dir).map((path) => [path, sha256(join(paths.dir, path))]);
  const second = await install(space, installDir, { dryRun: true });
  assert.deepEqual(actionsOf(second.plan, 'remove'), ['plugin/skills/short-lived/SKILL.md']);
  assert.deepEqual(actionsOf(second.plan, 'keep-edited'), ['plugin/skills/work/SKILL.md']);
  assert.equal(second.plan.recordChanges, true);
  assert.deepEqual(
    filesUnder(paths.dir).map((path) => [path, sha256(join(paths.dir, path))]),
    before,
  );
});

// ---------- containment ----------

test('nothing is written outside the install folder for a card name with .. or a separator', async (t) => {
  const space = await useSpace(t);
  const outer = useTempDir(t, 'ai-lore-install-');
  const installDir = join(outer, 'deep', 'install');
  const resolved = await lore(space);
  const model = resolved.parts.verbs[0];
  assert.ok(model);
  const crafted: ResolvedLore = {
    ...resolved,
    parts: {
      ...resolved.parts,
      verbs: [
        ...resolved.parts.verbs,
        { ...model, name: '../../../escaped' },
        { ...model, name: '..' },
        { ...model, name: 'a\\b' },
        { ...model, name: 'a/b' },
      ],
    },
  };
  const result = await installClaudeCode(crafted, installDir);
  assert.ok(result.ok);
  assert.equal(
    result.value.plan.reports.filter((report) => report.kind === 'unsafe-name').length,
    4,
  );
  assert.deepEqual(readdirSync(outer), ['deep']);
  assert.deepEqual(readdirSync(join(outer, 'deep')), ['install']);
  assert.deepEqual(readdirSync(installDir), ['claude-code']);
  const paths = claudeCodeInstallPaths(installDir);
  assert.deepEqual(readdirSync(paths.dir).sort(), ['checks', 'install.json', 'plugin']);
  assert.deepEqual(readdirSync(paths.plugin).sort(), ['.claude-plugin', 'skills']);
  assert.ok(!existsSync(join(paths.skills, 'a')));
  assert.ok(filesUnder(outer).every((path) => !path.includes('escaped')));
});

test('an install.json that lists a path outside the install folder removes nothing there', async (t) => {
  const space = await useSpace(t);
  const outer = useTempDir(t, 'ai-lore-install-');
  const installDir = join(outer, 'install');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const outside = join(outer, 'precious.txt');
  writeFileSync(outside, 'keep me\n');
  const record = JSON.parse(readFileSync(paths.record, 'utf8')) as InstallRecord;
  for (const path of ['../../precious.txt', outside, 'install.json']) {
    record.files.push({ path, kind: 'skill', sha256: sha256(outside), cards: [] });
  }
  writeFileSync(paths.record, JSON.stringify(record));

  const outcome = await install(space, installDir);
  assert.equal(readFileSync(outside, 'utf8'), 'keep me\n');
  assert.ok(existsSync(paths.record));
  assert.deepEqual(outcome.removed, []);
  assert.deepEqual(
    outcome.plan.reports.map((report) => report.kind),
    ['outside-target', 'outside-target', 'outside-target'],
  );
  assert.ok(outcome.plan.record.files.every((file) => !file.path.includes('precious')));
});

test('a symbolic link in the install folder that leads outside is not written through', async (t) => {
  const space = await useSpace(t);
  const outer = useTempDir(t, 'ai-lore-install-');
  const installDir = join(outer, 'install');
  const elsewhere = join(outer, 'elsewhere');
  mkdirSync(elsewhere);
  const paths = claudeCodeInstallPaths(installDir);
  mkdirSync(paths.plugin, { recursive: true });
  symlinkSync(elsewhere, paths.skills);

  const outcome = await install(space, installDir);
  assert.deepEqual(readdirSync(elsewhere), [], 'nothing went through the link');
  assert.ok(outcome.plan.reports.length >= 15);
  assert.ok(outcome.plan.reports.every((report) => report.kind === 'outside-target'));
  assert.ok(existsSync(join(paths.checks, 'write-guard.py')), 'the rest is installed');
  assert.ok(outcome.plan.record.files.every((file) => file.kind !== 'skill'));
});

test('an install folder that is a file is a failure, and nothing is written', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  writeFileSync(join(installDir, 'claude-code'), 'a file\n');
  const result = await installClaudeCode(await lore(space), installDir);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'target-invalid');
  assert.equal(readFileSync(join(installDir, 'claude-code'), 'utf8'), 'a file\n');
});

test('a file swapped for a symbolic link is not written through, not removed through and reported once', async (t) => {
  const space = await useSpace(t);
  const outer = useTempDir(t, 'ai-lore-install-');
  const installDir = join(outer, 'install');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const outside = join(outer, 'outside.md');
  writeFileSync(outside, 'keep me\n');
  const toOutside = join(paths.skills, 'work', 'SKILL.md');
  const toInside = join(paths.skills, 'plan', 'SKILL.md');
  const check = join(paths.checks, 'write-guard.py');
  for (const path of [toOutside, toInside, check]) rmSync(path);
  symlinkSync(outside, toOutside);
  symlinkSync(join(paths.skills, 'specify', 'SKILL.md'), toInside);
  symlinkSync(outside, check);
  const specify = readFileSync(join(paths.skills, 'specify', 'SKILL.md'), 'utf8');

  const outcome = await install(space, installDir, { overwriteEdited: true });
  assert.equal(readFileSync(outside, 'utf8'), 'keep me\n', 'nothing went through the links');
  assert.equal(readFileSync(join(paths.skills, 'specify', 'SKILL.md'), 'utf8'), specify);
  for (const path of [toOutside, toInside, check]) {
    assert.ok(lstatSync(path).isSymbolicLink(), `${path} is still the link`);
  }
  assert.deepEqual(outcome.removed, []);
  assert.deepEqual(outcome.written, ['install.json']);
  assert.deepEqual(outcome.plan.reports.map((report) => [report.kind, report.path]).sort(), [
    ['not-installed-by-companion', toInside],
    ['outside-target', 'checks/write-guard.py'],
    ['outside-target', 'plugin/skills/work/SKILL.md'],
  ]);
  const listed = outcome.plan.record.files.map((file) => file.path);
  for (const path of [
    'plugin/skills/work/SKILL.md',
    'plugin/skills/plan/SKILL.md',
    'checks/write-guard.py',
  ]) {
    assert.ok(!listed.includes(path), `${path} is not listed as installed`);
  }
  assert.ok(listed.includes('plugin/skills/specify/SKILL.md'), 'the rest stays installed');
});

test('an install.json that lists a folder does not stop the install, and the folder stays', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const record = JSON.parse(readFileSync(paths.record, 'utf8')) as InstallRecord;
  for (const path of ['plugin', '.', 'plugin/skills/work']) {
    record.files.push({ path, kind: 'skill', sha256: 'a'.repeat(64), cards: [] });
  }
  writeFileSync(paths.record, JSON.stringify(record));
  const before = filesUnder(paths.dir);

  const outcome = await install(space, installDir, { overwriteEdited: true });
  assert.deepEqual(filesUnder(paths.dir), before);
  assert.deepEqual(outcome.removed, []);
  assert.deepEqual(actionsOf(outcome.plan, 'forget').sort(), ['.', 'plugin', 'plugin/skills/work']);
  assert.ok(outcome.plan.reports.every((report) => report.kind === 'not-installed-by-companion'));
  assert.equal(outcome.plan.reports.length, 3);
  assert.equal(outcome.plan.record.files.length, before.length - 1, 'only the files are listed');
});

test('an install.json of a later version is a failure, and nothing is written or removed', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const record = JSON.parse(readFileSync(paths.record, 'utf8')) as InstallRecord;
  const later = JSON.stringify({ ...record, version: 2, somethingNew: true });
  writeFileSync(paths.record, later);
  rmSync(join(paths.skills, 'work', 'SKILL.md'));
  const before = filesUnder(paths.dir);

  const read = await readInstallRecord(paths.dir);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.error.kind, 'install-record-newer');
  for (const options of [{}, { dryRun: true }, { overwriteEdited: true }]) {
    const result = await installClaudeCode(await lore(space), installDir, options);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'install-record-newer');
  }
  assert.deepEqual(filesUnder(paths.dir), before);
  assert.equal(readFileSync(paths.record, 'utf8'), later);
});

test('an install that stopped before install.json was finished is completed by the next one, with no file left unlisted', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const paths = claudeCodeInstallPaths(installDir);
  addOwnVerb(space, 'short-lived', 'use when the Human Lead asks for it.');
  const plan = await planClaudeCodeInstall(await lore(space), installDir);
  assert.ok(plan.ok);

  // What is on disk after a process stopped half way: every path listed, some files written.
  const complete = await install(space, installDir);
  assert.deepEqual(complete.plan, plan.value);
  rmSync(join(paths.skills, 'work', 'SKILL.md'));
  rmSync(join(paths.checks, 'write-guard.py'));
  // Before the next install, the card of a file that was written leaves the Lore.
  removeOwnVerb(space, 'short-lived');

  const next = await install(space, installDir);
  assert.deepEqual(next.written.sort(), [
    'checks/write-guard.py',
    'install.json',
    'plugin/skills/work/SKILL.md',
  ]);
  assert.deepEqual(next.removed, ['plugin/skills/short-lived/SKILL.md']);
  assert.ok(!existsSync(join(paths.skills, 'short-lived')));
  const listed = next.plan.record.files.map((file) => file.path).sort();
  assert.deepEqual(
    filesUnder(paths.dir).filter((path) => path !== 'install.json'),
    listed,
    'every file in the folder is listed, and every listed file is there',
  );
});

test('install.json lists a new path before its file is written', async (t) => {
  const space = await useSpace(t);
  const outer = useTempDir(t, 'ai-lore-install-');
  const installDir = join(outer, 'install');
  const paths = claudeCodeInstallPaths(installDir);
  await install(space, installDir);

  // The folder of the new skill cannot be made, so the install stops at that write.
  addOwnVerb(space, 'blocked-verb', 'use when the Human Lead asks for it.');
  writeFileSync(join(paths.skills, 'blocked-verb'), 'a file where the folder goes\n');
  const stopped = await installClaudeCode(await lore(space), installDir);
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.equal(stopped.error.kind, 'write-failed');
  const interim = await readInstallRecord(paths.dir);
  assert.ok(interim.ok && interim.value !== null);
  assert.ok(
    interim.value.files.some((file) => file.path === 'plugin/skills/blocked-verb/SKILL.md'),
    'the path was listed before the write was tried',
  );

  rmSync(join(paths.skills, 'blocked-verb'));
  const next = await install(space, installDir);
  assert.deepEqual(next.written, ['plugin/skills/blocked-verb/SKILL.md']);
  assert.equal(next.plan.recordChanges, false, 'install.json already said what is there now');
});

test('installs of the same Lore that run at once leave one complete install', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const resolved = await lore(space);
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => installClaudeCode(resolved, installDir)),
  );
  assert.ok(results.every((result) => result.ok));
  const paths = claudeCodeInstallPaths(installDir);
  assert.ok(filesUnder(paths.dir).every((path) => !path.endsWith('.atomic-tmp')));

  const after = await install(space, installDir);
  assert.deepEqual(after.written, []);
  assert.equal(after.plan.recordChanges, false);
  assert.ok(after.plan.actions.every((item) => item.action === 'unchanged'));
  assert.deepEqual(
    filesUnder(paths.dir).filter((path) => path !== 'install.json'),
    after.plan.record.files.map((file) => file.path).sort(),
  );
});

test('the copies of the check scripts have the bytes of their sources and no execute bit', async (t) => {
  const space = await useSpace(t);
  const installDir = useTempDir(t, 'ai-lore-install-');
  const source = join(space.paths.lore, 'contracts', 'core', 'write-guard.py');
  chmodSync(source, 0o755);
  const outcome = await install(space, installDir);
  const paths = claudeCodeInstallPaths(installDir);
  const copies = outcome.plan.record.files.filter((file) => file.kind === 'check');
  assert.equal(copies.length, 3);
  for (const copy of copies) {
    const path = join(paths.dir, copy.path);
    assert.equal(sha256(path), copy.sha256);
    assert.equal(statSync(path).mode & 0o777, 0o644, `${copy.path} is not executable`);
  }
  assert.equal(sha256(join(paths.checks, 'write-guard.py')), sha256(source));
});
