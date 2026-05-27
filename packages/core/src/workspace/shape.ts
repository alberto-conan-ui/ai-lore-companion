/**
 * Project shape reader — Phase A of v0.8 (Publishing-mode awareness).
 *
 * AI-Lore v0.5.1 introduced an optional second project shape: a project may
 * declare a `publish:` block in its `workspace.yaml`, opting into a
 * `payload/` + `publish/` sibling layout instead of the default "Payload at
 * the project root" shape. This reader surfaces that declaration so the
 * companion can render shape-conditional UI (header chip, fourth pane,
 * Payload re-root) without each consumer re-parsing the manifest.
 *
 * The reader is **tolerant of malformed input**: a missing manifest, a
 * missing `publish:` block, or a malformed block all collapse to the
 * default shape. The companion never crashes its header on a bad
 * workspace.yaml.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Which arrangement of files this project declares. */
export type ProjectShape = 'default' | 'publishing';

/** Parsed `publish:` block — only fields the companion reads. */
export type PublishConfig = {
  /** Where Publish lives at the project root. Relative path, typically `./publish`. */
  path: string;
  /** Optional symlink target — an external mount or folder the project deploys to. */
  target?: string;
};

/** The companion's full view of a project's manifest, after Phase A's read. */
export type ProjectShapeResult = {
  /** Lore version from `core_version:` — `null` for legacy projects without the field. */
  coreVersion: string | null;
  /** Which shape this project declares. */
  shape: ProjectShape;
  /** Set when `shape === 'publishing'`; absent otherwise. */
  publish?: PublishConfig;
};

const CORE_VERSION_LINE = /^core_version\s*:\s*"?([0-9]+(?:\.[0-9]+)*)"?\s*$/m;

/**
 * Read project shape from a lore folder's `workspace.yaml`. Returns the
 * default shape with `coreVersion: null` when the manifest is unreadable —
 * the caller treats that as "render the default UI gracefully," never as
 * an error.
 *
 * `lorePath` is the project's `.ai-lore-<name>/` folder (same input
 * `readCoreVersion` takes), not the project root.
 */
export function readProjectShape(lorePath: string): ProjectShapeResult {
  const manifestPath = join(lorePath, 'workspace.yaml');
  if (!existsSync(manifestPath)) {
    return { coreVersion: null, shape: 'default' };
  }
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    return { coreVersion: null, shape: 'default' };
  }
  const versionMatch = text.match(CORE_VERSION_LINE);
  const coreVersion = versionMatch?.[1]?.trim() ?? null;
  const publish = parsePublishBlock(text);
  if (publish) {
    return { coreVersion, shape: 'publishing', publish };
  }
  return { coreVersion, shape: 'default' };
}

/**
 * Extract the minimal `publish:` block from raw `workspace.yaml` text.
 *
 * Format (per the methodology):
 *
 *   publish:
 *     path: ./publish
 *     target: ~/Drive/foo   # optional
 *
 * The parser is line-oriented and tolerant: a block missing `path:` is
 * treated as malformed and returns `null` (the caller falls back to
 * default shape). The full-fat YAML structure is not parsed — only the
 * two fields the companion reads.
 */
function parsePublishBlock(text: string): PublishConfig | null {
  const lines = text.split('\n');
  // Find the `publish:` header at column 0 (block, not nested).
  const headerIdx = lines.findIndex((l) => /^publish\s*:\s*$/.test(l));
  if (headerIdx === -1) return null;
  let path: string | null = null;
  let target: string | undefined;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    // Block ends at the first non-indented non-empty line.
    if (line.length === 0) continue;
    if (!/^\s/.test(line)) break;
    const pathMatch = line.match(/^\s+path\s*:\s*"?([^"#\n]+?)"?\s*(?:#.*)?$/);
    if (pathMatch?.[1]) {
      path = pathMatch[1].trim();
      continue;
    }
    const targetMatch = line.match(/^\s+target\s*:\s*"?([^"#\n]+?)"?\s*(?:#.*)?$/);
    if (targetMatch?.[1]) {
      target = targetMatch[1].trim();
    }
  }
  if (!path) return null;
  const out: PublishConfig = { path };
  if (target) out.target = target;
  return out;
}
