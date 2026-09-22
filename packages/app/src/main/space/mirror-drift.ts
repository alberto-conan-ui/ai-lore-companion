/**
 * Runs the skeleton generators named by mirror cards for the repositories
 * dashboard. The generators print frontmatter scalars, while cards hold the
 * decoded scalar values, so this boundary owns the small decoding step.
 */

import {
  type CommandRunner,
  type MirrorCard,
  type MirrorDrift,
  mirrorDrift,
  runSucceeded,
} from '@ai-lore-companion/core';
import type { Root } from '@ai-lore-companion/core';

/** A dashboard refresh must not wait two minutes for one skeleton generator. */
export const MIRROR_GENERATOR_TIMEOUT_MS = 10_000;

type PayloadRoot = Root & { kind: 'repository' | 'publish-area' };

function isPayloadRoot(root: Root): root is PayloadRoot {
  return root.kind === 'repository' || root.kind === 'publish-area';
}

/** A missing or refused root path must never make Python inspect the Space's cwd. */
function canRunGenerator(root: PayloadRoot): boolean {
  return root.path !== '' && (root.tracking.tracked || root.tracking.reason !== 'path-refused');
}

/** Decode the double-quoted scalar syntax emitted by the shipped generators. */
export function decodeGeneratorLine(line: string): string {
  const quoted = /^"((?:[^"\\]|\\["\\])*)"$/u.exec(line);
  if (quoted === null) throw new Error('the skeleton generator printed an invalid quoted line');
  return (quoted[1] as string).replace(/\\(["\\])/gu, '$1');
}

/** Convert generator output to the scalar values stored in a mirror card. */
export function generatorSkeleton(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .filter((line) => line !== '')
    .map(decodeGeneratorLine);
}

function mirrorPath(root: PayloadRoot): string {
  return `lore/mirrors/${root.name}.md`;
}

/**
 * A failed Lore read must replace a previous result, so a dashboard never
 * presents an earlier match as current after it can no longer verify it.
 */
export function uncheckedPayloadMirrors(
  roots: readonly Root[],
  checkedAt: string,
): Record<string, MirrorDrift> {
  return Object.fromEntries(
    roots.filter(isPayloadRoot).map((root) => [
      root.id,
      {
        path: mirrorPath(root),
        state: 'not-checked',
        added: 0,
        removed: 0,
        checkedAt,
      },
    ]),
  );
}

/** Run every payload's named generator against the payload's real folder. */
export async function checkPayloadMirrors(arg: {
  runner: CommandRunner;
  spaceRoot: string;
  roots: readonly Root[];
  mirrors: readonly MirrorCard[];
  checkedAt: string;
}): Promise<Record<string, MirrorDrift>> {
  const results = await Promise.all(
    arg.roots.filter(isPayloadRoot).map(async (root) => {
      const path = mirrorPath(root);
      if (!canRunGenerator(root)) {
        return [
          root.id,
          mirrorDrift({ path, stored: [], generated: null, checkedAt: arg.checkedAt }),
        ] as const;
      }
      const card = arg.mirrors.find((candidate) => candidate.payload === root.name);
      if (card === undefined) {
        return [
          root.id,
          { path, state: 'no-mirror', added: 0, removed: 0, checkedAt: arg.checkedAt },
        ] as const;
      }
      try {
        const run = await arg.runner.run(
          'python3',
          [`${arg.spaceRoot}/${card.generator}`, root.path],
          {
            cwd: arg.spaceRoot,
            timeoutMs: MIRROR_GENERATOR_TIMEOUT_MS,
          },
        );
        const generated = runSucceeded(run) ? generatorSkeleton(run.stdout) : null;
        return [
          root.id,
          mirrorDrift({ path, stored: card.skeleton, generated, checkedAt: arg.checkedAt }),
        ] as const;
      } catch {
        return [
          root.id,
          mirrorDrift({ path, stored: card.skeleton, generated: null, checkedAt: arg.checkedAt }),
        ] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}
