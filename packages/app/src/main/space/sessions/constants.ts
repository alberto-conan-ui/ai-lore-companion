/**
 * The values of a guarded session's files (phase M4.4). Each is read from here
 * and from nowhere else, so that a finding of phase M4.8 (the gate's tests with
 * the real engine) is a change to one line of this file.
 *
 * What these values rest on is `packages/docs/m4-1-claude-code-findings.md`.
 */

/**
 * The environment variable that holds the companion's id of the session. It is
 * set in the environment of the engine's process (the PTY) and in `env` of the
 * session's `settings.json`, so a shell command of the session reads it. The
 * name of the session's journal entry ends with this id, which is what the
 * contract journal-append-forward checks.
 */
export const SESSION_ID_ENV = 'AI_LORE_SESSION_ID';

/** The names of a session's generated files, inside `<desk>/sessions/<session id>/`. */
export const SESSION_FILES = {
  settings: 'settings.json',
  mcp: 'mcp.json',
  hooksDir: 'hooks',
  preWrite: 'hooks/pre-write.py',
  postWrite: 'hooks/post-write.py',
  /** Written by the before-write adapter: one JSON line per refusal, read into the log when the session ends. */
  refusals: 'refusals.jsonl',
  /** Written by the spend adapter (M14.6): what the engine reported the session spent. */
  spend: 'spend.json',
  spendHook: 'hooks/session-spend.py',
} as const;

/** The mode of a session's folder and of its `hooks` folder. */
export const SESSION_DIR_MODE = 0o700;

/** The mode of every file of a session. An adapter is run as `python3 <path>`, so it needs no execute bit. */
export const SESSION_FILE_MODE = 0o600;

/**
 * The engine's tools that write a file through a path. Observed in phase M4.1:
 * `Write`, `Edit` and `NotebookEdit` exist in Claude Code 2.1.276; `MultiEdit`
 * does not, and a matcher that names it does no harm (older engines have it).
 */
export const FILE_WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;

/** The hook matcher for the file-writing tools. */
export const FILE_WRITING_MATCHER = FILE_WRITING_TOOLS.join('|');

/**
 * The timeouts of the before-write hook, in seconds. Observed in phase M4.1: a
 * hook that runs longer than its `timeout` does NOT block the write. The
 * adapter therefore refuses by itself before the engine's timeout is reached:
 * one child may take `childSeconds`, the adapter as a whole `adapterSeconds`
 * (an alarm signal that prints a refusal), and the engine waits `hookSeconds`.
 * The write-guard starts `git` up to three times with 10 seconds each.
 */
export const PRE_WRITE_TIMEOUTS = {
  childSeconds: 35,
  adapterSeconds: 50,
  hookSeconds: 60,
} as const;

/** The timeouts of the after-write hook, in seconds. lore-integrity reads the whole Lore. */
export const POST_WRITE_TIMEOUTS = {
  childSeconds: 60,
  adapterSeconds: 80,
  hookSeconds: 90,
} as const;

/** The check scripts a session is not started without, by file name in the install's `checks` folder. */
export const REQUIRED_CHECKS = [
  'write-guard.py',
  'journal-append-forward.py',
  'lore-integrity.py',
] as const;

/** How long the question "where is python3" may take, in milliseconds. */
export const PYTHON_PROBE_TIMEOUT_MS = 10_000;

/** The refusals of one session that are copied into the log when it ends. */
export const MAX_LOGGED_REFUSALS = 200;

/** Maximum time a transient PM dashboard refresh may remain pending. */
export const DASHBOARD_REFRESH_TIMEOUT_MS = 120_000;

/**
 * The timeouts of the spend hook, in seconds (M14.6, `profile-shape-architecture.md`
 * 3.6). A `Stop` hook, not a before-write hook: it never blocks anything, so
 * both numbers are small. `adapterSeconds` is the adapter's own watchdog
 * (an alarm that gives up and writes nothing); `hookSeconds` is what Claude
 * Code waits before it stops waiting on the hook and moves on regardless.
 */
export const SPEND_HOOK_TIMEOUTS = {
  adapterSeconds: 8,
  hookSeconds: 10,
} as const;
