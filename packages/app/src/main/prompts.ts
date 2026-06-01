/**
 * Prompts catalog — the verbs visible in a running AI tab's left column
 * (Phase D). Sourced from the project's vendored methodology:
 *
 *   - `<lore>/process/verbs/*.md` — one file per verb (the methodology
 *     places them at install time). The filename stem is the verb name;
 *     the slash form is `/ai-lore-<stem>`.
 *   - `<lore>/process/verbs/verbs.index.md` — the description table. Its
 *     `| Operation | Kind | What it does |` rows carry the one-line
 *     description shown next to each verb.
 *
 * The catalog reads at AI-tab mount and re-reads on a debounced FS event,
 * so a methodology upgrade brings new verbs into a live tab without an app
 * restart (gate: "Methodology upgrades bring new verbs without an app
 * restart").
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chokidar from 'chokidar';

export type PromptEntry = {
  /** The verb's filename stem — e.g. `orient`, `chat`, `save-point`. */
  name: string;
  /** The slash form invoked from the engine — `/ai-lore-<name>`. */
  slash: string;
  /** One-line description from `verbs.index.md`. Empty when the index is
   *  missing or the verb does not appear in the operations table. */
  description: string;
  /** Whether the operations table marked this as a `verb` or a `bookend`. */
  kind: 'verb' | 'bookend' | 'unknown';
};

/**
 * Read the prompts catalog from a project's vendored verbs folder. Returns
 * the empty list when the folder is absent or unreadable — the renderer
 * surfaces an empty state, never an error.
 */
export function readPrompts(lorePath: string): PromptEntry[] {
  const verbsDir = verbsDirOf(lorePath);
  const files = listVerbFiles(verbsDir);
  if (files.length === 0) return [];
  const indexRows = parseVerbsIndex(verbsDir);
  return files.map((name) => {
    const row = indexRows.get(name);
    return {
      name,
      slash: `/ai-lore-${name}`,
      description: row?.description ?? '',
      kind: row?.kind ?? 'unknown',
    };
  });
}

function verbsDirOf(lorePath: string): string {
  return join(lorePath, 'process', 'verbs');
}

/**
 * Whether the AI-Lore engine binding is **installed** for this project — i.e.
 * the verbs are wired as the engine's native slash commands, so offering the
 * catalog's `/ai-lore-<verb>` rows is meaningful. A project on the plain-text
 * path has the vendored methodology (so {@link readPrompts} still finds verbs)
 * but no native wiring, so the slash forms would not resolve; the renderer
 * shows a bootstrap hint instead.
 *
 * Detection is per-engine. Today only the Claude binding exists: `install`
 * writes one skill per verb under `<project>/.claude/skills/ai-lore-<verb>/`.
 * The presence of any `ai-lore-*` skill directory is the install marker — a
 * single missing file (a partial install) still counts as installed enough to
 * show the catalog; a wholly absent set is the plain-text path. Returns `false`
 * on any read error (treat unknown as not-installed → show the safe hint).
 */
export function isEngineBindingInstalled(projectRoot: string): boolean {
  const skillsDir = join(projectRoot, '.claude', 'skills');
  if (!existsSync(skillsDir)) return false;
  try {
    return readdirSync(skillsDir).some((entry) => entry.startsWith('ai-lore-'));
  } catch {
    return false;
  }
}

/** Names (filename stems) of every verb `.md` file under the verbs directory,
 *  excluding the index file. Order is deterministic (sorted) so the renderer
 *  groups produce stable visual output regardless of FS readdir order. */
function listVerbFiles(verbsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(verbsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.md') && f !== 'verbs.index.md')
    .map((f) => f.slice(0, -'.md'.length))
    .sort();
}

type IndexRow = { kind: 'verb' | 'bookend' | 'unknown'; description: string };

/**
 * Parse `verbs.index.md`'s operations table. The table has the canonical
 * shape:
 *
 *   | Operation | Kind | What it does |
 *   |---|---|---|
 *   | [`<name>`](./<name>.md) | verb | <description> |
 *
 * Returns a map from verb name → kind + description. Tolerant of format
 * drift: a malformed row is skipped, missing values fall back to defaults,
 * a missing file yields an empty map.
 */
function parseVerbsIndex(verbsDir: string): Map<string, IndexRow> {
  const out = new Map<string, IndexRow>();
  let text: string;
  try {
    text = readFileSync(join(verbsDir, 'verbs.index.md'), 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    // Skip header rows (`| Operation | Kind | ... |`) and separator rows
    // (`|---|---|---|`).
    if (line.includes('---')) continue;
    if (/\bOperation\b/.test(line) && /\bKind\b/.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const nameMatch = cells[0]?.match(/\[`([^`]+)`\]/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (!name) continue;
    const kindRaw = cells[1]?.toLowerCase() ?? '';
    const kind: IndexRow['kind'] =
      kindRaw === 'verb' || kindRaw === 'bookend' ? kindRaw : 'unknown';
    const description = cells.slice(2).join(' | ').trim();
    out.set(name, { kind, description });
  }
  return out;
}

/**
 * Watch a project's `<lore>/process/verbs/` folder and fire `onChange` after a
 * short debounce whenever a verb file is added, edited, or removed. Used by
 * main to push `PromptsChanged` to the project's window.
 *
 * Returns a teardown function — call on context teardown.
 */
export function watchPrompts(lorePath: string, onChange: () => void): () => Promise<void> {
  const verbsDir = verbsDirOf(lorePath);
  // `ignoreInitial: true` — we want change events, not the first crawl. The
  // renderer reads the initial state via the `PromptsList` IPC anyway.
  const watcher = chokidar.watch(verbsDir, {
    ignoreInitial: true,
    persistent: true,
    // The companion's process/* ignore would silence these by default; we
    // need the events here, so the watcher is independent.
  });
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 200);
  };
  watcher.on('add', schedule);
  watcher.on('change', schedule);
  watcher.on('unlink', schedule);
  return async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
}
