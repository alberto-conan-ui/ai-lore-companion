/**
 * The engines the companion knows about by name: what each is called, how it
 * is installed and signed in, and whether the companion can run a guarded
 * Space session with it. The order of `ENGINE_CATALOG` is the order every
 * list of engines uses.
 *
 * The commands and links are the product document's, checked on the makers'
 * pages on 2026-09-19.
 */

import { basename } from 'node:path';
import type { EngineEntry, EngineParam } from '../../engines/index.js';

/** The command name of Claude Code, the one engine of the MVP. */
export const CLAUDE_BINARY_NAME = 'claude';

/** Whether the registry entry is Claude Code, judged by the file name of its binary. */
export function isClaudeEngine(engine: EngineEntry): boolean {
  const name = basename(engine.binary).toLowerCase();
  return name === CLAUDE_BINARY_NAME || name === `${CLAUDE_BINARY_NAME}.exe`;
}

/** The engines the companion knows. The order is the order of every list. */
export type EngineCatalogId = 'claude-code' | 'codex' | 'antigravity' | 'opencode';

/** How the companion asks an engine whether it is signed in. */
export type EngineSignInCheck =
  | { kind: 'claude-auth-status' } // `claude auth status --json`, field `loggedIn`
  | { kind: 'exit-code'; args: readonly string[] } // exit 0 = signed in
  | { kind: 'opencode-auth-list' } // at least one provider listed = signed in
  | { kind: 'codex-login-status' } // `codex login status`: a line "Logged in…" = signed in, "Not logged in" = not
  | { kind: 'none' }; // the state is "Not checked"

/** One engine of the catalog. */
export type EngineCatalogEntry = {
  catalogId: EngineCatalogId;
  /** The id the entry has in `engines.json` and on IPC. */
  engineId: string;
  name: string;
  maker: string | null;
  binary: string;
  /** The macOS install command, run by `$SHELL -i -l -c`. */
  installCommand: string;
  /** A program the install command needs, or null. */
  installNeeds: 'npm' | null;
  signInCommand: string;
  signInCheck: EngineSignInCheck;
  /** The parameters a catalog entry gets when the stored entry has none (3.4 rule 3). */
  seedParams: readonly EngineParam[];
  /** Whether the companion can run a guarded Space session with it. */
  guardedSessions: boolean;
  /** Whether Set up this computer is not ready without it. */
  required: boolean;
  /** One line shown under the row, or null. */
  note: string | null;
  /** The maker's page. */
  page: string;
};

/** The four engines the companion knows, in the order every list uses. */
export const ENGINE_CATALOG: readonly EngineCatalogEntry[] = [
  {
    catalogId: 'claude-code',
    engineId: 'default.claude',
    name: 'Claude Code',
    maker: 'Anthropic',
    binary: 'claude',
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    installNeeds: null,
    signInCommand: 'claude auth login',
    signInCheck: { kind: 'claude-auth-status' },
    seedParams: [],
    guardedSessions: true,
    required: true,
    note: null,
    page: 'https://code.claude.com/docs/en/setup',
  },
  {
    catalogId: 'codex',
    engineId: 'default.codex',
    name: 'Codex CLI',
    maker: 'OpenAI',
    binary: 'codex',
    installCommand: 'npm install -g @openai/codex',
    installNeeds: 'npm',
    signInCommand: 'codex login',
    signInCheck: { kind: 'codex-login-status' },
    seedParams: [],
    // Real-engine checks 1 and 3 of M10.7 passed in a real run (M10.9,
    // m10-engine-findings.md, "Codex CLI, phase M10.9"): the before-write hook
    // fires and blocks a write into the Lore. Check 2 (the session-server
    // round trip) could not complete end to end in headless `codex exec`
    // (codex's own approval gate refuses an MCP tool call in that mode before
    // it reaches the server); left as a manual check for a real session.
    guardedSessions: true,
    required: false,
    note: null,
    page: 'https://learn.chatgpt.com/docs/codex/cli',
  },
  {
    catalogId: 'antigravity',
    engineId: 'default.antigravity',
    name: 'Antigravity CLI',
    maker: 'Google',
    binary: 'agy',
    installCommand: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    installNeeds: null,
    signInCommand: 'agy',
    signInCheck: { kind: 'none' },
    seedParams: [{ text: '--dangerously-skip-permissions', defaultOn: true }],
    // Re-confirmed in a real run (M10.9, m10-engine-findings.md, "Antigravity
    // CLI, phase M10.9"): the before-write hook still refuses a write into the
    // Lore with --dangerously-skip-permissions ticked, so the flag stays out
    // of ANTIGRAVITY_OPTIONS.guardChanging and the session is guarded.
    guardedSessions: true,
    required: false,
    note: null,
    page: 'https://antigravity.google/docs/cli/install',
  },
  {
    catalogId: 'opencode',
    engineId: 'default.opencode',
    name: 'OpenCode',
    maker: null,
    binary: 'opencode',
    installCommand: 'curl -fsSL https://opencode.ai/install | bash',
    installNeeds: null,
    signInCommand: 'opencode auth login',
    signInCheck: { kind: 'opencode-auth-list' },
    seedParams: [],
    guardedSessions: false,
    required: false,
    note: 'Also runs DeepSeek models: choose DeepSeek when signing in.',
    page: 'https://opencode.ai/docs',
  },
];

/** The catalog entry of `engineId`, or `null` when it names none. */
export function catalogEntryById(engineId: string): EngineCatalogEntry | null {
  return ENGINE_CATALOG.find((entry) => entry.engineId === engineId) ?? null;
}

/**
 * The catalog entry `engine` was merged into, by its `id`. A hand-added entry
 * (one `mergeEnginesWithCatalog` appended rather than merged) is not treated
 * as a catalog engine here, even when its binary happens to match one.
 */
export function catalogEntryFor(engine: EngineEntry): EngineCatalogEntry | null {
  return catalogEntryById(engine.id);
}

/** Whether `engineId` is one of the catalog's own ids. */
export function isCatalogEngineId(engineId: string): boolean {
  return ENGINE_CATALOG.some((entry) => entry.engineId === engineId);
}

/**
 * Whether the companion can run a guarded Space session with `engine`: a
 * catalog engine whose `guardedSessions` is `true`, or a hand-added Claude
 * Code (the Human Lead's own entry, kept with other arguments).
 */
export function canRunGuardedSession(engine: EngineEntry): boolean {
  const catalog = catalogEntryFor(engine);
  if (catalog !== null) return catalog.guardedSessions;
  return isClaudeEngine(engine);
}
