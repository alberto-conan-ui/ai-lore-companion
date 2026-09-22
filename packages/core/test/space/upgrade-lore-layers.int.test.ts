import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { upgradeLoreLayers } from '../../src/space/upgrade/lore-layers.js';

// The upgrade that moves a contract between layers, run against the real
// shipped template and checked with the Lore's own lore-integrity script.
//
// The Space's issue #95: contracts was the only part of the Lore with no
// `default/` folder, so `spec-before-breakdown` — a way of working, not a
// safety rule — sat in `core/`, where no Space may replace it. Moving it in
// the template is four file operations; a Space that already exists needs
// this, because the card's old path is named in the frontmatter of three
// corpus entries.

const run = promisify(execFile);

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

/** The shipped template, as it is in this repository. */
const TEMPLATE = findTemplateDir();

const made: string[] = [];
after(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/**
 * A Space whose Lore is the template's, as setup would have copied it, with
 * `spec-before-breakdown` put back in `core/` and taken out of `default/` so
 * that it stands where a Space created before the change stands. Its own
 * contract is written beside the layer folders, to prove the upgrade keeps it.
 */
async function aSpaceBeforeTheChange(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ai-lore-upgrade-'));
  made.push(root);
  // The whole template, not only `lore/`: the corpus entries point at
  // `ai_readme.md` and at `publish/specs/index.md`, and lore-integrity checks
  // that every reference resolves.
  await cp(TEMPLATE, root, { recursive: true });

  const contracts = join(root, 'lore', 'contracts');
  await cp(
    join(contracts, 'default', 'spec-before-breakdown.md'),
    join(contracts, 'core', 'spec-before-breakdown.md'),
  );
  await rm(join(contracts, 'default'), { recursive: true, force: true });

  // The index files as they were before the change: core lists the card, and
  // the part's index names only `core/`.
  const coreIndex = join(contracts, 'core', 'index.md');
  await writeFile(
    coreIndex,
    `${(await readFile(coreIndex, 'utf8')).replace(/\n*$/, '\n')}- [spec-before-breakdown.md](./spec-before-breakdown.md): a unit of work that has a spec has no breakdown until the spec is agreed; guards Specifying, and has only a rule.\n`,
  );
  const partIndex = join(contracts, 'index.md');
  await writeFile(
    partIndex,
    (await readFile(partIndex, 'utf8')).replace(
      /- \[default\/\]\(\.\/default\/index\.md\).*\n/,
      '',
    ),
  );

  // The old path, as three corpus entries name it in their frontmatter.
  for (const entry of ['unit-of-work.md', 'specifying.md', 'breakdown.md']) {
    const path = join(root, 'lore', 'corpus', 'core', entry);
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replaceAll(
        'lore/contracts/default/spec-before-breakdown.md',
        'lore/contracts/core/spec-before-breakdown.md',
      ),
    );
  }

  // The Space's own contract, which the upgrade must not touch.
  await writeFile(
    join(contracts, 'house-style.md'),
    "---\ntype: contract\nname: house-style\npillar: producing\ntarget: payload\ncheck: null\nwhen: null\n---\n\n# house-style\n\nThe Space's own contract. It has only a rule.\n\n## The rule\n\nNothing here matters to the test but that it survives.\n",
  );
  await writeFile(
    partIndex,
    `${(await readFile(partIndex, 'utf8')).replace(/\n*$/, '\n')}- [house-style.md](./house-style.md): the Space's own contract, rule only.\n`,
  );
  return root;
}

/** The Lore's own check, run as a session's engine runs it. */
async function loreIntegrity(root: string): Promise<string> {
  const script = join(root, 'lore', 'contracts', 'core', 'lore-integrity.py');
  const { stdout } = await run('python3', [script, '--space', root, '--when', 'after']);
  return stdout;
}

test('a Space from before the change is consistent as it stands', async () => {
  const root = await aSpaceBeforeTheChange();
  // The three corpus entries point at the card in `core/`, which is where it
  // is, so the old arrangement passes. The upgrade has to keep it passing:
  // moving the card without repointing them would break every one of them.
  assert.match(await loreIntegrity(root), /passes the check/);
});

test('the upgrade moves the contract, keeps the Space its own, and the Lore passes', async () => {
  const root = await aSpaceBeforeTheChange();

  const upgraded = await upgradeLoreLayers(root, TEMPLATE);
  assert.ok(upgraded.ok, 'the upgrade runs');

  const contracts = join(root, 'lore', 'contracts');
  assert.deepEqual(
    (await readdir(join(contracts, 'default'))).sort(),
    ['index.md', 'spec-before-breakdown.md'],
    'the card and its index are in default/',
  );
  assert.ok(
    !(await readdir(join(contracts, 'core'))).includes('spec-before-breakdown.md'),
    'and no longer in core/',
  );

  // Criterion 4 of #95: the Space keeps its own contracts.
  assert.ok(
    (await readdir(contracts)).includes('house-style.md'),
    "the Space's own contract is untouched",
  );
  assert.match(await readFile(join(contracts, 'index.md'), 'utf8'), /house-style\.md/);
  assert.match(
    await readFile(join(contracts, 'index.md'), 'utf8'),
    /- \[default\/\]\(\.\/default\/index\.md\)/,
    "the part's index now names default/",
  );

  // The safety contracts stay where no Space can replace them.
  const core = await readdir(join(contracts, 'core'));
  for (const name of ['write-guard.md', 'lore-integrity.md', 'journal-append-forward.md']) {
    assert.ok(core.includes(name), `${name} stays core`);
  }

  assert.match(await loreIntegrity(root), /passes the check/, 'lore-integrity passes afterwards');
});

test('running it again changes nothing', async () => {
  const root = await aSpaceBeforeTheChange();

  const first = await upgradeLoreLayers(root, TEMPLATE);
  assert.ok(first.ok);
  assert.ok(first.value.written.length > 0, 'the first run has work to do');

  const again = await upgradeLoreLayers(root, TEMPLATE);
  assert.ok(again.ok);
  assert.deepEqual(
    again.value,
    { written: [], removed: [], listed: [] },
    'the second run writes nothing',
  );
  assert.match(await loreIntegrity(root), /passes the check/);
});

test('a Space with no lore folder is left alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-lore-upgrade-empty-'));
  made.push(root);
  await mkdir(join(root, 'workbench'), { recursive: true });

  const upgraded = await upgradeLoreLayers(root, TEMPLATE);

  assert.ok(upgraded.ok);
  assert.deepEqual(upgraded.value, { written: [], removed: [], listed: [] });
});
