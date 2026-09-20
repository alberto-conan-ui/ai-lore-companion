import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { makeTempDir } from '@ai-lore-companion/core/testing';
import {
  SPACE_BUILD_FIELD,
  hasSpaceBuildMarker,
  isSpaceBuild,
  spaceRoutingDecision,
} from '../../../src/main/space/build-marker.js';
import { resetElectronStub, setAppPath } from '../electron-stub.js';

// The Space build's identity marker (M11.1, architecture document section 2.4):
// electron-builder's `extraMetadata` writes `aiLoreSpaceBuild: true` into the
// packaged app's own `package.json`; `isSpaceBuild` reads it back via
// `app.getAppPath()`, and `spaceRoutingDecision` combines it with the
// `AI_LORE_SPACE_ROUTING` environment variable — routing is on with either.

afterEach(() => {
  resetElectronStub();
});

test('hasSpaceBuildMarker: true only when the field is exactly true', () => {
  assert.equal(hasSpaceBuildMarker({ [SPACE_BUILD_FIELD]: true }), true);
  assert.equal(hasSpaceBuildMarker({ [SPACE_BUILD_FIELD]: false }), false);
  assert.equal(hasSpaceBuildMarker({ [SPACE_BUILD_FIELD]: 'true' }), false);
  assert.equal(hasSpaceBuildMarker({}), false);
  assert.equal(hasSpaceBuildMarker(null), false);
  assert.equal(hasSpaceBuildMarker(undefined), false);
});

test('isSpaceBuild: true when the running app package.json carries the marker', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir.dir, 'package.json'),
      JSON.stringify({ name: '@ai-lore-companion/app', aiLoreSpaceBuild: true }),
    );
    setAppPath(dir.dir);
    assert.equal(isSpaceBuild(), true);
  } finally {
    dir.cleanup();
  }
});

test('isSpaceBuild: false when the package.json has no marker (the v0.8 build)', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir.dir, 'package.json'),
      JSON.stringify({ name: '@ai-lore-companion/app' }),
    );
    setAppPath(dir.dir);
    assert.equal(isSpaceBuild(), false);
  } finally {
    dir.cleanup();
  }
});

test('isSpaceBuild: false when the package.json cannot be read', () => {
  const dir = makeTempDir();
  try {
    setAppPath(dir.dir); // no package.json written
    assert.equal(isSpaceBuild(), false);
  } finally {
    dir.cleanup();
  }
});

test('isSpaceBuild: false when the package.json is malformed JSON', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir.dir, 'package.json'), '{ not valid json');
    setAppPath(dir.dir);
    assert.equal(isSpaceBuild(), false);
  } finally {
    dir.cleanup();
  }
});

test('isSpaceBuild: false when the marker field is present but not the boolean true', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir.dir, 'package.json'),
      JSON.stringify({ name: '@ai-lore-companion/app', aiLoreSpaceBuild: 'true' }),
    );
    setAppPath(dir.dir);
    assert.equal(isSpaceBuild(), false);
  } finally {
    dir.cleanup();
  }
});

test('spaceRoutingDecision: marker only is on', () => {
  assert.equal(spaceRoutingDecision(false, true), true);
});

test('spaceRoutingDecision: environment variable only is on', () => {
  assert.equal(spaceRoutingDecision(true, false), true);
});

test('spaceRoutingDecision: neither is off', () => {
  assert.equal(spaceRoutingDecision(false, false), false);
});

test('spaceRoutingDecision: both is on', () => {
  assert.equal(spaceRoutingDecision(true, true), true);
});
