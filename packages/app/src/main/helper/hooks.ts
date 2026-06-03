/**
 * Generators for the read-only helper's out-of-tree configuration (AI Helper,
 * CR1). Everything the app hands `claude` lives in a throwaway temp dir — never
 * the user's `.claude/` — and is passed via `--settings <file>`:
 *
 *   - a **permission profile** that allows only `Read` / `Grep` / `Glob` and
 *     denies every mutation tool, so the v1 helper is read-only by construction
 *     (Channel-D "read-only launch" capability), and
 *   - **`SessionStart` + `Stop` hooks** that POST to the middleman — the
 *     session→app leg of the protocol (Channel B). `SessionStart` signals the
 *     session is up; `Stop` extracts the last assistant text from the
 *     transcript and returns it as the turn's answer.
 *
 * The port, token, and app session id are **baked into the generated hook
 * scripts** at materialise time — the temp dir is ours and short-lived, so
 * there is nothing to leak into the user's environment.
 *
 * These are pure string builders so the shapes can be asserted in tests without
 * spawning anything.
 */

import type { HelperAction } from '../../shared/ipc.js';

/** Where a hook POSTs, and the identity it carries. */
export type HookWiring = { port: number; token: string; sessionId: string };

/** The tools the read-only profile permits / forbids. Read/Grep/Glob are
 *  allow-listed so they don't prompt in interactive `default` mode; every
 *  mutation path is denied. */
const ALLOW_TOOLS = ['Read', 'Grep', 'Glob'] as const;
const DENY_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch'] as const;

/**
 * The full `claude` argv for a read-only helper launch: the deny-writes
 * `--settings` profile + the helper model. Pure so the launch shape can be
 * asserted in tests without spawning — the `--settings` profile is the
 * security-critical part.
 *
 * **Read-only rests on the deny-writes profile** (see {@link settingsJson}),
 * *not* on a permission mode. CR5 tried `--permission-mode plan` (read-only by
 * design, a supported API) as the first-class guard, but the real-app proof
 * showed plan mode hijacks the helper into *planning-agent* behaviour — it
 * tries to write a plan file and "exit plan mode" rather than just answering a
 * read-only question. Read-only held (the write was blocked), but the Q&A UX
 * regressed badly, so plan mode was backed out in favour of the deny-list,
 * which CR1–CR4 already answered cleanly on. See
 * [`blueprint/contracts/helper-read-only.contract.md`] for the standing rule
 * and the finding.
 */
export function helperLaunchArgs(opts: {
  settingsPath: string;
  model: string;
  /** The session's `--mcp-config` file (CR10). When set, the helper loads ONLY
   *  this MCP server (`--strict-mcp-config`, so the user's own MCP servers never
   *  join the read-only session) and is pre-authorized for the report tools. */
  mcpConfigPath?: string;
}): string[] {
  const args = ['--settings', opts.settingsPath, '--model', opts.model];
  if (opts.mcpConfigPath) {
    args.push('--mcp-config', opts.mcpConfigPath, '--strict-mcp-config');
    // Pre-authorize the report tools so the model's call lands without a
    // permission prompt the driven PTY could never answer. The deny-writes
    // profile is untouched — the report tool is the only new capability, and it
    // writes to the app, not the project (read-only holds). See
    // [`blueprint/contracts/helper-read-only.contract.md`].
    args.push('--allowedTools', ...ALLOWED_MCP_TOOLS);
  }
  return args;
}

/** The MCP server key in the helper's `--mcp-config` — the prefix Claude uses to
 *  namespace its tools (`mcp__<key>__<tool>`). */
export const MCP_SERVER_KEY = 'ailore';

/** The report tools the read-only helper may call (CR10), in Claude's prefixed
 *  `mcp__<server>__<tool>` form — pre-authorized at launch so a call lands
 *  without a permission prompt the driven PTY could never answer. The dashboard
 *  crawl plus the two curation ops report structured; `report_answer` (prose
 *  Q&A) still owes its move. Each must match a tool {@link ../helper/mcp-host.ts}
 *  registers. */
export const ALLOWED_MCP_TOOLS = [
  'report_dashboard',
  'report_humanized',
  'report_consolidation',
].map((t) => `mcp__${MCP_SERVER_KEY}__${t}`);

/** The session's `--mcp-config` JSON (CR10) — a single local HTTP MCP server
 *  (the app-hosted {@link ../helper/mcp-host.ts}) the read-only helper reports
 *  structured results through. The bearer token authenticates the session; the
 *  URL is its per-session endpoint. Pure so the shape is assertable in tests. */
export function mcpConfigJson(opts: { url: string; token: string }): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_KEY]: {
          type: 'http',
          url: opts.url,
          headers: { Authorization: `Bearer ${opts.token}` },
        },
      },
    },
    null,
    2,
  );
}

/** The `--settings` JSON: the deny-writes permission profile plus the two
 *  hooks, each invoking a generated script in the same temp dir. */
export function settingsJson(opts: {
  sessionStartScript: string;
  stopScript: string;
}): string {
  const settings = {
    permissions: {
      allow: [...ALLOW_TOOLS],
      deny: [...DENY_TOOLS],
    },
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: nodeCommand(opts.sessionStartScript) }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: nodeCommand(opts.stopScript) }] }],
    },
  };
  return JSON.stringify(settings, null, 2);
}

/** Quote a path for the `node '<path>'` hook command — the temp dir is
 *  app-generated, but a user home with a space or quote still has to survive. */
function nodeCommand(scriptPath: string): string {
  return `node '${scriptPath.replace(/'/g, "'\\''")}'`;
}

/** The `SessionStart` hook script — POSTs "started" so the app can mark the
 *  session ready and release the first turn. Fire-and-forget. */
export function sessionStartScript(w: HookWiring): string {
  return `// AI-Lore helper SessionStart hook — generated, do not edit.
const PORT = ${w.port};
const TOKEN = ${JSON.stringify(w.token)};
const SESSION_ID = ${JSON.stringify(w.sessionId)};
fetch('http://127.0.0.1:' + PORT + '/session/started', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
  body: JSON.stringify({ sessionId: SESSION_ID }),
}).catch(() => {});
`;
}

/**
 * The `Stop` hook script — reads the transcript path off the hook's stdin JSON,
 * extracts the last assistant text block, and POSTs it as the turn's answer.
 * The final transcript line lags the `Stop` event (the flush race the spike
 * found), so it retries a few times until text appears.
 */
export function stopScript(w: HookWiring): string {
  return `// AI-Lore helper Stop hook — generated, do not edit.
import { readFileSync } from 'node:fs';
const PORT = ${w.port};
const TOKEN = ${JSON.stringify(w.token)};
const SESSION_ID = ${JSON.stringify(w.sessionId)};

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch {}
const transcriptPath = input.transcript_path;

function lastAssistantText(path) {
  let text = '';
  try {
    for (const line of readFileSync(path, 'utf8').split('\\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj && obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        const parts = obj.message.content
          .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text);
        if (parts.length) text = parts.join('');
      }
    }
  } catch {}
  return text;
}

async function main() {
  // The final assistant line lags the Stop event, and an in-progress turn may
  // have flushed an earlier (partial / intermediate) assistant message first.
  // So don't take the first non-empty read — poll until the last assistant text
  // stops changing across two consecutive reads (stable ~300ms), keeping the
  // best-so-far as the fallback if it never settles within the window.
  let answer = '';
  let prev = null;
  let stable = 0;
  for (let i = 0; i < 24; i++) {
    const text = transcriptPath ? lastAssistantText(transcriptPath) : '';
    if (text) answer = text;
    if (text && text === prev) {
      stable++;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    prev = text;
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    await fetch('http://127.0.0.1:' + PORT + '/session/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ sessionId: SESSION_ID, answer }),
    });
  } catch {}
}
main();
`;
}

/**
 * Build the read-only prompt for a canned action. `statusPath` lets
 * `summarize-pending` need only `Read`. `changedPaths` carries the app-supplied
 * drift list for `what-changed` — the helper can't run git (Bash is denied), so
 * the changed files are handed in and it reads what it needs to explain them.
 * `lightOrient` picks the cheap orient (one file read) for engines that have no
 * AI-Lore skill — see the `orient` case.
 */
export function promptFor(
  action: HelperAction,
  args: {
    statusPath: string;
    memoryPath?: string;
    today?: string;
    changedPaths?: string[];
    lightOrient?: boolean;
    /** CR10 — when set, the `dashboard` crawl is told to **call** this MCP tool
     *  with the board instead of printing JSON (the structured egress, Claude).
     *  Unset keeps the print-JSON path (Gemini, until its MCP egress lands). */
    reportTool?: string;
  },
): string {
  switch (action) {
    case 'orient':
      // Two orient styles (CR7). The full walk — read `ai_readme.md`, load the
      // methodology, walk the focus chain — is cheap for Claude (it loads the
      // installed AI-Lore skill) but is a dozen+ file-read round-trips for a
      // generic engine like headless Gemini, blowing the turn timeout. So a
      // non-skill engine gets a **light** orient: read just `status.index.md`,
      // the focus-chain head the methodology itself calls the "orient in
      // seconds" hub. Both are idempotent confirmations.
      if (args.lightOrient && args.statusPath) {
        return `Read the file at ${args.statusPath} to ground yourself in this AI-Lore project's current focus and state. Then reply in one short line confirming you are oriented and ready — no other output.`;
      }
      return 'Orient yourself to this AI-Lore project: if you have not already, read `ai_readme.md` at the project root and follow it to load the methodology and walk the focus chain to the active focus. Then confirm in one short line that you are oriented and ready — no other output.';
    case 'summarize-pending':
      return `Read the file at ${args.statusPath} and give me a short, plain-prose summary of what is currently pending or in progress in this project. A few sentences — no preamble.`;
    case 'what-changed': {
      const paths = args.changedPaths ?? [];
      if (paths.length === 0) {
        return 'This project has no uncommitted changes right now — the working tree is clean against its baseline. Reply in one short line saying so.';
      }
      const list = paths.map((p) => `- ${p}`).join('\n');
      return `These files have uncommitted changes in this project:\n${list}\n\nRead what you need to and give me a short, plain-prose summary of what changed and anything worth noting. A few sentences — no preamble.`;
    }
    case 'dashboard': {
      // The surfacing crawl (CR9 Phase 4 → live hydration). The helper reads the
      // WHOLE lore and returns a `FocusBoard` the app renders as a glanceable
      // dashboard. The job is **completeness, not polish** — list everything raw
      // and unmerged; the human cleans up the wording (Humanize) and groups
      // related items (Consolidate) in the UI. The spike (2026-06-03) proved this
      // "surface everything, don't reason" framing makes even the cheapest model
      // far more complete (Haiku 0 → 11 loose-ends, Gemini flash → 13) than an
      // expensive model asked to reason and polish (Opus got 3).
      const memory = args.memoryPath ?? '';
      const today = args.today ?? '';
      // The board's shape + the completeness rules are identical across engines;
      // only the **delivery** differs — call the MCP tool (structured, CR10) or
      // print the JSON (the legacy scrape, until an engine's MCP egress lands).
      const shape = `{"project":"string","crumb":"Project · Status","rollup":{"inPlay":0,"active":0,"hanging":0,"looseEnds":0},"staleness":{"state":"behind|current","label":"string","since":"string","text":"string"},"focuses":[{"id":"kebab","name":"string","kind":"active|paused|hanging|headless","line":"string","estimate":0,"steps":[{"name":"string","line":"string","verdict":"on-track|in-progress|at-risk|not-started|blocked","progress":0,"active":false}],"note":"string","attention":[{"source":"Backlog|Bug|Idea|Drift|Lore","text":"string","since":"string"}]}]}`;
      const delivery = args.reportTool
        ? `Deliver the board by CALLING the \`${args.reportTool}\` tool with a single \`board\` argument matching this exact shape — do NOT print it, the app receives it through the tool call:
${shape}`
        : `Return EXACTLY this JSON (no prose, no markdown fences):
${shape}`;
      const outro = args.reportTool
        ? `Call \`${args.reportTool}\` exactly once with the complete board. Do not print the JSON.`
        : 'Output ONLY the JSON object.';
      return `You are a strictly READ-ONLY assistant. Read this AI-Lore project's lore (its Memory) and report where the project stands. Do not write or edit anything.

YOUR ONE GOAL IS COMPLETENESS. Surface EVERYTHING you find. Do NOT group, merge, summarize, or decide whether items belong together — list each thing separately. Do NOT polish the wording — raw is fine, and internal codenames (like "CR1") are fine to include. It is far better to over-list than to miss anything; a human cleans up, rewords, and merges afterward. When in doubt, include it.

The lore Memory is at: ${memory}
Key files: status/status.index.md (names the ACTIVE focus, PAUSED focuses, journal trail); status/focus/*.focus.md (each has a status: Active/Paused/Achieved; backlog.focus.md is a holding pen; status/focus/archive/ is CLOSED — ignore it); action-tree/<focus>/ (the active focus's steps, named CR1..CRN); journal/live/*.md (their Handover sections list "Loose ends" and "Watch"); save-points/ (the milestone ledger — the gap from the latest save-point date to today, ${today}, is the sign-off currency).

${delivery}

Rules:
- "focuses": one per non-archived focus.
  * ACTIVE/PAUSED -> kind "active"/"paused", estimate 0-100, and "steps" = EVERY node in its action tree (list them all; raw "CR" names are fine; set active:true on the one in progress).
  * ACHIEVED-but-unarchived -> kind "hanging", estimate 100, a "note".
  * EXACTLY ONE kind "headless", name "No focus owns these", "attention" = EVERY flagged thing that no active focus owns: every backlog item, every bug, every deferred idea, every watch-out, every loose end in the journals. ONE ENTRY EACH — DO NOT MERGE related ones. Err on the side of MORE entries.
- each "attention": source, text (one sentence, raw is fine), since (a date).
- "staleness": from the ledger. "state":"behind" if the latest save-point predates recent shipped work; "since" = the last save-point date.
- "rollup": inPlay=#focuses, active=#active, hanging=#hanging, looseEnds=#headless attention items.

${outro}`;
    }
  }
}

/** Number a list of the picked rows' texts for a curation prompt. */
function numbered(texts: string[]): string {
  return texts.map((t, i) => `${i + 1}. "${t}"`).join('\n');
}

/**
 * The **Humanize** micro-turn (CR9 curation workbench): reword the picked rows in
 * plain language. Like the dashboard, only the **delivery** differs by engine —
 * `reportTool` set (Claude, CR10) tells the model to **call** `report_humanized`
 * with a `rewrites` array; unset keeps the print-JSON path (Gemini) the renderer
 * still scrapes. The wording itself is unchanged from the proven text turn.
 */
export function humanizePrompt(texts: string[], reportTool?: string): string {
  const ask =
    'Rewrite each of these project items in plain, friendly language for a non-technical project owner — say what each one actually is, with no codenames and no jargon. Keep each to one short sentence.';
  const delivery = reportTool
    ? `Deliver the rewrites by CALLING the \`${reportTool}\` tool with a single \`rewrites\` argument — a JSON array of strings, one rewrite per item in the same order. Do NOT print them.`
    : 'Reply with ONLY a JSON array of strings, one rewrite per item, in the same order, nothing else:';
  return `${ask} ${delivery}\n${numbered(texts)}`;
}

/**
 * The **Consolidate** micro-turn (CR9): merge the picked rows into one. Assertive
 * on purpose — the user's selection IS the decision; the model only produces the
 * shape (spike 2026-06-03). Delivery flips per engine the same way Humanize does.
 */
export function consolidatePrompt(texts: string[], reportTool?: string): string {
  const ask =
    'The project owner has SELECTED these items, deciding they belong together as one piece of work — this is their call, do NOT question whether they belong together. Express the single combined item well.';
  const delivery = reportTool
    ? `Deliver the merged item by CALLING the \`${reportTool}\` tool with a \`title\` (a short plain title) and a \`text\` (one plain sentence describing the combined work). Do NOT print them.`
    : 'Reply with ONLY a JSON object, nothing else: {"title": "a short plain title", "text": "one plain sentence describing the combined work"}';
  return `${ask} ${delivery}\n${numbered(texts)}`;
}
