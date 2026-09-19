# M10 — findings from the real engines

Written 2026-09-19 during stage M10. This file records what was observed when the adapters of phases M10.6, M10.7 and M10.8 were run against the installed engines. It complements section 2 of `m10-architecture.md`, which records what was found while designing. Every run was made in a scratch folder under the session's scratchpad, never in this repository or a real Space, with standard input closed.

"Pass" means the engine did what the adapter needs. "Skipped" means the check could not be run, with the reason.

## Antigravity CLI (agy 1.2.7), phase M10.6

Runs used `agy -p … --print-timeout 240s`.

| Check | Observed | Result |
|---|---|---|
| 1. Instructions and skills, without `--dangerously-skip-permissions` | The model quoted the first sentence of the session instructions and listed the Lore's skills, including `session-orient`. It also listed the Human Lead's two global agy skills, which confirms that the user's own configuration still loads. | Pass |
| 2. Session server round trip (`request_writing`, `await_answer`, `leave_writing`) without the flag | agy refused the call itself: "a tool required the mcp permission that headless mode cannot prompt for". This is agy's own permission layer in headless mode, not the Lore hook. | Expected |
| 2. The same, with the flag | The grant, claim and board JSON came back correctly, after the fix below. | Pass |
| 3. `write_to_file` into `lore/` and into `workbench/`, with the flag | The write into `lore/` was refused with the write guard's mode sentence and the file was not created. The write into `workbench/` was allowed and the file was created. | Pass |
| 4. Shell rules, with the flag | `git status` was allowed and ran. `echo x > lore/….md`, which the rules do not cover, was answered `force_ask` by the hook, but agy ran it and the file was created in `lore/`. | Fail (fixed by ruling, see below) |
| 4. The deny-rule case `git log -1 --output=lore/…` | Not run: the account's quota ran out ("Individual quota reached… Resets in 145h"). Covered by the headless tests. | Skipped |
| 5. A hook that exits 1 or sleeps past its time limit | Not run (quota). The handling is shared with Claude Code and is covered by the existing headless test "the before-write adapter refuses on every fault". | Skipped |
| 6. The PostToolUse input for a write | Not run (quota). Covered by a headless test using the input shape observed in checks 1 to 4. | Skipped |
| 7. A shell command outside the rules, with the flag | Same run as check 4: it ran. | Fail (fixed by ruling) |

**Correction to section 2.3 of the architecture document.** A call to a session-server tool arrives at the hook with `toolCall.name` set to `call_mcp_tool` for every server. The server and tool are in `toolCall.args.ServerName` (observed: `lore_ailore`) and `toolCall.args.ToolName`. The adapter matches on `ServerName`. Before this fix, every session-server call fell through to "ask", which blocks a headless run.

**Ruling of the Human Lead (2026-09-19) on check 4.** With `--dangerously-skip-permissions` on, agy does not ask when the hook answers `force_ask`, so an uncovered shell command runs. When an Antigravity session is started with that flag, the before-write hook refuses such a command instead of asking (`--uncovered-shell deny`). The flag stays ticked by default and is not guard-changing for Antigravity, so the session is still guarded. File-writing tools were refused with the flag on in check 3.

**Quota.** The live runs of the architect and of the M10.6 developer used up the Human Lead's Antigravity quota. It resets about six days after 2026-09-19. Checks 4 (deny rule), 5 and 6 wait for that reset.

## Antigravity CLI, phase M10.9 (2026-09-19, second account, quota available)

Three runs, `agy -p … --add-dir <space> --add-dir <session folder> --dangerously-skip-permissions --print-timeout 240s`, standard input closed, in a scratch folder. Session in Read only.

| Check | Observed | Result |
|---|---|---|
| M10.9 item 4, the re-confirmation: `write_to_file` of `lore/m10-9-a.md`, `replace_file_content` in `lore/index.md`, `run_command` `git log -1 --output=lore/m10-9-b.md`, asked for by name in one prompt | All three refused with the adapter's reason (`write-guard refuses the write…` for the first two; `The command is refused in a companion session: it matches the rule "Bash(git *--output*)"` for the third). Neither `lore/m10-9-a.md` nor `lore/m10-9-b.md` exists afterwards; `lore/index.md`'s content is byte-for-byte unchanged (SHA-256 compared before and after). | Pass. `--dangerously-skip-permissions` stays out of `ANTIGRAVITY_OPTIONS.guardChanging`; no fallback applied. |
| M10.6 check 4, the deny-rule case `git log -1 --output=lore/…`, run again (quota had blocked it) | The same call as above: refused, matching `Bash(git *--output*)`. | Pass |
| M10.6 check 4, the uncovered-shell case, run again with `--uncovered-shell deny` (a fourth named call in the same prompt: `run_command` `echo x > lore/m10-9-c.md`) | Refused with the reason `This session skips Antigravity's own prompts, so a shell command outside the session's rules is refused. Run it yourself, or start the session without --dangerously-skip-permissions.` The file was not created. | Pass. Matches the headless test and the Human Lead's ruling of section 2.3. |
| M10.6 check 6, the `PostToolUse` input for a write (a fifth named call in the same prompt: `write_to_file` of `workbench/m10-9-d.md`, allowed) | The wrapped after-write command's stdin, captured before the real hook ran on it, was: `{"toolCall":{"name":"write_to_file","args":{"TargetFile":"…/workbench/m10-9-d.md","CodeContent":"m10-9","Overwrite":false,"Description":"…","toolAction":"Writing file","toolSummary":"Write to workbench"}},"stepIdx":10,"conversationId":"…","workspacePaths":["…/agy-a","…/sessions/s-agy-a"],"transcriptPath":"…/transcript_full.jsonl","artifactDirectoryPath":"…/brain/…","modelName":"gemini-pro-agent","error":""}`. `error` is the empty string for a successful write. | Pass. Confirms the `PostToolUse` shape the installed guide documents (`docs/hooks.md`), now Observed rather than Checked. |
| M10.6 check 5, a hook that exits 1 (the `PreToolUse` command replaced with `sh -c "exit 1"` for one run; a single `write_to_file` into `lore/`) | The write did not happen; agy reported "It was refused." | Antigravity fails closed on a hook that exits non-zero. |
| M10.6 check 5, a hook that sleeps past its timeout (the command replaced with `sh -c "sleep 75"`, longer than `PRE_WRITE_TIMEOUTS.hookSeconds` = 60; a single `write_to_file` into `lore/`) | The write did not happen; agy reported "It was refused." | Antigravity fails closed on a hook that times out. |

Three live runs, all in one scratch Space fixture per run (a fresh fixture each time), all headless (`agy -p`, standard input closed). Total M10.9 Antigravity runs: 3 (within the phase's limit of 8).

Re-confirmed on 2026-09-19 with agy 1.2.7: a hook refusal blocks write_to_file, replace_file_content and run_command with --dangerously-skip-permissions on.

## Codex CLI (codex-cli 0.155.0), phase M10.7

| Check | Observed | Result |
|---|---|---|
| Sign-in state: `codex login status` | Printed `Not logged in` and exited 1. The architect had recorded exit 0 for the same state, so the exit code cannot be relied on. The new check reads the text and ignores the exit code. | Recorded |
| 1. `codex debug prompt-input` with the adapter's `-c` values (needs no account) | The `developer_instructions` text is the first message, role `developer`, ahead of Codex's own skills block and the `AGENTS.md` message. A scratch skill was listed. | Pass |
| `codex mcp list` and `codex mcp get --json` with the adapter's `mcp_servers.ailore.*` values (needs no account) | The server is shown as enabled; `env_http_headers` is `{"authorization": "AI_LORE_MCP_HEADER"}` as set, so the token stays in the environment. | Pass |
| 2 to 5 (a real session: guard, sandbox, session tools) | Not run: `codex login status` answered "Not logged in" on 2026-09-19. | Skipped |

## Codex CLI, phase M10.9 (2026-09-19, signed in: `codex login status` answers `Logged in using ChatGPT`)

Two real-engine runs. The adapter's `launch` targets the interactive `codex` binary; `codex exec --help` (0.155.0) has no `--ask-for-approval`/`-a` (only the interactive binary has it — there is no one to approve a request in `exec`), so the real-engine checks run `codex exec` with every argument of the adapter's launch except that pair, `-c` values and `--dangerously-bypass-hook-trust` included, standard input closed, in a scratch folder.

| Check | Observed | Result |
|---|---|---|
| 2. Session server round trip: the model calls `request_writing` on the `ailore` server, then `await_answer` | The model found and called `request_writing` (so `tools/list` reached it), but codex's own environment refused the call itself: `MCP tool call requires approval, but approval policy is never`; no ticket was issued, so `await_answer` had nothing to wait on and was refused the same way. No call reached this session's broker. | Partial. `codex exec` (no TTY) has no path to grant an MCP tool call; this is a limit of headless testing, not an observed defect of the adapter's `-c mcp_servers.ailore.*` values (`codex mcp get` already showed them read correctly in M10.7). Whether the interactive `codex` PTY session's own approval prompt asks the Human Lead before every session-server call, on top of the companion's own dialogs, is Unverified — see the manual checklist. |
| 3. `apply_patch` into `lore/` in Read only | Refused by the write-guard's `PreToolUse` hook: `hook: PreToolUse Blocked`, with the write-guard's mode sentence; noted in `refusals.jsonl`. | Pass. The `-c hooks.PreToolUse` value runs for a real session (Unverified in M10.7 is now Observed). |
| 3. `apply_patch` into `workbench/` | Refused before reaching the write-guard hook: `patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings`. Nothing was noted in `refusals.jsonl` (codex's own sandbox refused it, not the hook). | Codex's own `--sandbox read-only` blocks every write regardless of path; in headless `exec` (no TTY to ask) this is an outright refusal rather than a question. Consistent with the capability text "shell commands run in Codex's read-only sandbox and ask you before they write" — in `exec` there is nobody to ask, so it refuses. |
| 4. Without `--dangerously-bypass-hook-trust`: does the `-c` hook run? | The same `apply_patch` into `lore/` was refused (`patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings`), but `refusals.jsonl` stayed empty: the write-guard hook did not run (an untrusted hook is not loaded without the bypass, as section 2.4 says). Codex's own sandbox refused the write anyway. | The bypass is needed for the write-guard hook itself to run; without it the write is still refused, but only by codex's own sandbox, not by the Lore's check. |
| 5. A shell write, `echo x > lore/m10-9-codex-c.md` | Refused: `Shell command failed with 'operation not permitted'`. No file created. | Pass (fails safe). |
| 6. `codex login status` | `Logged in using ChatGPT`, confirming `parseCodexLoginStatus` reads it as `true` (already covered by the headless test of M10.7). | Pass |

Codex invocations: 3 (one `codex exec` call failed on an argument the interactive-only `--ask-for-approval` cannot take in `exec` and made no model call; two real calls that used tokens). Within the phase's limit of 6.

## OpenCode, phase M10.8

| Check | Observed | Result |
|---|---|---|
| `command -v opencode`, `opencode auth list` | Not found; exit 1 and 127. | Skipped |
| All real-engine checks | Not run: opencode was not found on the PATH on 2026-09-19. The configuration, the guard plugin and the Python hook are covered by headless tests, one of which loads the generated plugin and runs it against the real check scripts. | Skipped |

## OpenCode, phase M10.9 (2026-09-19)

OpenCode real-engine checks not run: the Human Lead chose not to sign in, on 2026-09-19. `guardedSessions` stays `false`.

## Tester's review of the three adapters

The independent tester of M10.6 to M10.8 found two defects in the Antigravity adapter and fixed them. A hook input with a missing or malformed `toolCall` was answered "ask"; it now raises a fault and is refused, as for the other engines. The session server was recognised when `ServerName` contained `ailore`, so a server of the user's own agy configuration with a similar name would have been allowed; it now must equal `lore_ailore`. The tester ran the Claude Code hooks of this change and of the previous commit side by side on 17 inputs; all outputs and exit codes were identical.

## Claude Code, phase M10.9 (2026-09-19)

Section 2.2 left one question Unverified: whether a `PreToolUse` hook's `deny` still blocks a write when the session runs with `--dangerously-skip-permissions`. One real run, in a scratch folder: a headless Claude Code session (`claude --setting-sources '' --settings … --mcp-config … --strict-mcp-config --plugin-dir … --append-system-prompt … --allowedTools … --dangerously-skip-permissions -p "<prompt>"`, standard input closed) asked to write into `lore/` while Read only.

| Check | Observed | Result |
|---|---|---|
| M10.9 item 3: a write into `lore/` in Read only, with `--dangerously-skip-permissions` ticked | The `Write` tool call was blocked by the `PreToolUse` hook with the write-guard's mode sentence, noted in `refusals.jsonl` (`kind: refused, tool: Write`); the file was not created. Claude's own answer: "The write-guard refused the write because the session is in Read only, where it can write only to the Workbench." | Pass. The hook still blocks under `--dangerously-skip-permissions`; the guard line for an unguarded Claude Code session needs no change from 3.6's proposed text. |

Two Claude Code invocations (the first, before a harness fix to the desk path used by the session record, answered "the desk has no record of the session" and still refused the write for the same reason — a Read-only default; the second, after the fix, found the actual Read-only record and gave the same result). Within the phase's limit of 3.

## State on 2026-09-19 before M10.9

- Codex: the Human Lead signed in (`codex login status` answers `Logged in using ChatGPT`). M10.9 runs checks 2 to 5.
- OpenCode: installed by the Human Lead, who chose not to sign in for now. It stays unguarded; its checks wait until a sign-in.
- Antigravity: the Human Lead switched agy to an account with quota; a one-prompt run answered without a quota error. M10.9 runs the deny-rule check, checks 5 and 6, and check 4 again with `--uncovered-shell deny`.
- `guardedSessions` is set to true in the catalog only for an engine whose checks passed (ruling 5 of section 1 of the architecture document).

## State after M10.9 (2026-09-19)

- Claude Code: `guardedSessions` stays `true`. The deferred check (item 3) passed: the write-guard hook still blocks a write under `--dangerously-skip-permissions`.
- Antigravity: `guardedSessions` becomes `true`. The re-confirmation passed (no fallback applied); the remaining M10.6 checks (deny rule, hook faults, `PostToolUse` input, the uncovered-shell case) all passed.
- Codex: `guardedSessions` becomes `true`. Checks 1 and 3 (the hook itself, the piece that makes a session guarded) passed cleanly; check 2 (the session-server round trip) could not complete end to end in headless `codex exec`, because codex's own approval gate refuses any MCP tool call in that mode before it reaches the session server — recorded above, and left as a manual check for the Human Lead in a real interactive session.
- OpenCode: `guardedSessions` stays `false`. The Human Lead chose not to sign in on 2026-09-19.
