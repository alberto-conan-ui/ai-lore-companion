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
export function helperLaunchArgs(opts: { settingsPath: string; model: string }): string[] {
  return ['--settings', opts.settingsPath, '--model', opts.model];
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
  args: { statusPath: string; changedPaths?: string[]; lightOrient?: boolean },
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
  }
}
