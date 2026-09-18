import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  SPACE_MANIFEST_FORMAT,
  SPACE_MANIFEST_TYPE,
  type SpaceManifest,
  parseSpaceManifest,
  serializeSpaceManifest,
} from '../../src/index.js';
import { loreTemplateDir } from '../support/index.js';

const EXAMPLE = [
  '---',
  'type: space',
  'format: 1',
  'name: example-space',
  'github:',
  '  repository: example-owner/example-space',
  '  project: 1',
  'repositories:',
  '  - name: example-app',
  '    github: example-owner/example-app',
  'publish_areas:',
  '  - name: publish',
  '    path: publish',
  '  - name: handbook',
  '---',
  '',
  "# The Space's manifest",
  '',
].join('\n');

const EXAMPLE_MANIFEST: SpaceManifest = {
  format: 1,
  name: 'example-space',
  github: { repository: 'example-owner/example-space', project: 1 },
  repositories: [{ name: 'example-app', github: 'example-owner/example-app' }],
  publishAreas: [
    { name: 'publish', path: 'publish' },
    { name: 'handbook', path: null },
  ],
};

/** The example with one line replaced, or with lines added before the closing `---`. */
function example(change: { replace?: [string, string]; add?: string[] }): string {
  let lines = EXAMPLE.split('\n');
  if (change.replace !== undefined) {
    const [from, to] = change.replace;
    assert.equal(lines.includes(from), true, `the example has no line "${from}"`);
    lines = lines.map((line) => (line === from ? to : line));
  }
  if (change.add !== undefined) {
    const end = lines.indexOf('---', 1);
    lines.splice(end, 0, ...change.add);
  }
  return lines.join('\n');
}

function failureOf(text: string): { kind: string; message: string } {
  const result = parseSpaceManifest(text);
  assert.equal(result.ok, false, 'the manifest should not be read');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

// The reader and the writer of the frontmatter subset are tested in `frontmatter.test.ts`.

// ---------- parseSpaceManifest ----------

test('parseSpaceManifest reads the example of the manifest card', () => {
  assert.deepEqual(parseSpaceManifest(EXAMPLE), { ok: true, value: EXAMPLE_MANIFEST });
  assert.equal(SPACE_MANIFEST_FORMAT, 1);
  assert.equal(SPACE_MANIFEST_TYPE, 'space');
});

test('parseSpaceManifest reads the manifest of the Lore template, which setup has not filled', () => {
  const text = readFileSync(join(loreTemplateDir(), 'lore', 'space.md'), 'utf8');
  assert.deepEqual(parseSpaceManifest(text), {
    ok: true,
    value: {
      format: 1,
      name: '',
      github: { repository: '', project: 0 },
      repositories: [],
      publishAreas: [{ name: 'publish', path: 'publish' }],
    },
  });
});

test('parseSpaceManifest keeps the keys it does not know, at every level', () => {
  const text = example({
    replace: ['  project: 1', '  project: 1\n  host: github.example.invalid'],
    add: ['runtimes:', '  - name: staging', 'owner_note: "kept"'],
  })
    .replace(
      '    github: example-owner/example-app',
      '    github: example-owner/example-app\n    default_branch: main',
    )
    .replace('  - name: handbook', '  - name: handbook\n    audience: team');
  const parsed = parseSpaceManifest(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.github.extra, { host: 'github.example.invalid' });
  assert.deepEqual(parsed.value.repositories[0]?.extra, { default_branch: 'main' });
  assert.deepEqual(parsed.value.publishAreas[1]?.extra, { audience: 'team' });
  assert.deepEqual(parsed.value.extra, { runtimes: [{ name: 'staging' }], owner_note: 'kept' });

  const written = serializeSpaceManifest(parsed.value, '\nbody\n');
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.deepEqual(parseSpaceManifest(written.value), parsed);
});

test('parseSpaceManifest reports each malformed manifest with its own kind', () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ['no frontmatter', '# The manifest\n', 'no-frontmatter', /does not begin with frontmatter/],
    [
      'a value that a full YAML reader refuses',
      example({ replace: ['name: example-space', 'name: examplespace'] }),
      'readers-differ',
      /full YAML reader/,
    ],
    [
      'CRLF line ends',
      EXAMPLE.replace(/\n/g, '\r\n'),
      'outside-subset',
      /line 1: .*carriage return/,
    ],
    ['frontmatter not closed', '---\ntype: space\n', 'no-frontmatter', /not closed/],
    [
      'outside the subset',
      example({ replace: ['name: example-space', "name: 'example-space'"] }),
      'outside-subset',
      /line 4: .*single quotes/,
    ],
    [
      'a comment at the end of a line, as the architecture document writes its example',
      example({ replace: ['  project: 1', '  project: 1   # the number'] }),
      'outside-subset',
      /line 7/,
    ],
    [
      'another type',
      example({ replace: ['type: space', 'type: index'] }),
      'not-a-space-manifest',
      /type is "index"/,
    ],
    [
      'no type',
      example({ replace: ['type: space', 'kind: space'] }),
      'not-a-space-manifest',
      /null/,
    ],
    [
      'a later format',
      example({ replace: ['format: 1', 'format: 2'] }),
      'unsupported-format',
      /format is 2/,
    ],
    [
      'format as text',
      example({ replace: ['format: 1', 'format: "1"'] }),
      'invalid-manifest',
      /format/,
    ],
    [
      'no name',
      example({ replace: ['name: example-space', 'title: x'] }),
      'invalid-manifest',
      /name/,
    ],
    [
      'github as text',
      example({ replace: ['github:', 'github: example-owner/example-space'] }).replace(
        /\n {2}repository: .*\n {2}project: 1/,
        '',
      ),
      'invalid-manifest',
      /github must be a map/,
    ],
    [
      'a repository address that is not owner/name',
      example({
        replace: ['  repository: example-owner/example-space', '  repository: example-space'],
      }),
      'invalid-manifest',
      /owner\/name/,
    ],
    [
      'a project that is not a number',
      example({ replace: ['  project: 1', '  project: seven'] }),
      'invalid-manifest',
      /github\.project/,
    ],
    [
      'repositories as a list of text',
      example({ replace: ['  - name: example-app', '  - example-app'] }).replace(
        '\n    github: example-owner/example-app',
        '',
      ),
      'invalid-manifest',
      /repositories must be a list of maps/,
    ],
    [
      'a repository with no github',
      example({ replace: ['    github: example-owner/example-app', '    branch: main'] }),
      'invalid-manifest',
      /repositories\[0\]\.github/,
    ],
    [
      'a repository name that leaves repos/',
      example({ replace: ['  - name: example-app', '  - name: "../outside"'] }),
      'invalid-manifest',
      /repositories\[0\]\.name/,
    ],
    [
      'two payloads of one name',
      example({ replace: ['  - name: handbook', '  - name: Example-App'] }),
      'invalid-manifest',
      /used by another payload/,
    ],
    [
      'a publish path that leaves the Space',
      example({ replace: ['    path: publish', '    path: "../publish"'] }),
      'invalid-manifest',
      /publish_areas\[0\]\.path/,
    ],
    [
      'an absolute publish path',
      example({ replace: ['    path: publish', '    path: "/tmp/publish"'] }),
      'invalid-manifest',
      /publish_areas\[0\]\.path/,
    ],
    [
      'no publish_areas',
      EXAMPLE.replace(/publish_areas:[\s\S]*?\n---/, '---'),
      'invalid-manifest',
      /publish_areas must be a list/,
    ],
  ];
  for (const [label, text, kind, message] of cases) {
    const failure = failureOf(text);
    assert.equal(failure.kind, kind, label);
    assert.match(failure.message, message, label);
  }
});

// ---------- serializeSpaceManifest ----------

test('serializeSpaceManifest writes the keys in the order of the card, and reads back the same', () => {
  const text = serializeSpaceManifest(EXAMPLE_MANIFEST, "\n# The Space's manifest\n");
  assert.deepEqual(text, { ok: true, value: EXAMPLE });
});

test('serializeSpaceManifest gives a new file a short body, and quotes what the subset asks', () => {
  const text = serializeSpaceManifest({
    ...EXAMPLE_MANIFEST,
    name: '2026 space',
    repositories: [],
  });
  assert.equal(text.ok, true);
  if (!text.ok) return;
  assert.match(text.value, /^name: "2026 space"$/m);
  assert.match(text.value, /^repositories: \[\]$/m);
  assert.match(text.value, /\n---\n\n# The Space's manifest\n/);
});

test('serializeSpaceManifest refuses a manifest that could not be read back', () => {
  const cases: Array<[string, SpaceManifest]> = [
    ['a name with a line break', { ...EXAMPLE_MANIFEST, name: 'a\nb' }],
    [
      'a repository name with a slash',
      { ...EXAMPLE_MANIFEST, repositories: [{ name: 'a/b', github: 'o/n' }] },
    ],
    [
      'a project that is not a whole number',
      { ...EXAMPLE_MANIFEST, github: { repository: 'o/n', project: 1.5 } },
    ],
    [
      'a publish path outside the Space',
      { ...EXAMPLE_MANIFEST, publishAreas: [{ name: 'publish', path: '../x' }] },
    ],
  ];
  for (const [label, manifest] of cases) {
    const text = serializeSpaceManifest(manifest);
    assert.equal(!text.ok && text.error.kind, 'invalid-manifest', label);
  }
});
