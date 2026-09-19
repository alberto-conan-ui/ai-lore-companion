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

## Codex CLI (codex-cli 0.155.0), phase M10.7

| Check | Observed | Result |
|---|---|---|
| Sign-in state: `codex login status` | Printed `Not logged in` and exited 1. The architect had recorded exit 0 for the same state, so the exit code cannot be relied on. The new check reads the text and ignores the exit code. | Recorded |
| 1. `codex debug prompt-input` with the adapter's `-c` values (needs no account) | The `developer_instructions` text is the first message, role `developer`, ahead of Codex's own skills block and the `AGENTS.md` message. A scratch skill was listed. | Pass |
| `codex mcp list` and `codex mcp get --json` with the adapter's `mcp_servers.ailore.*` values (needs no account) | The server is shown as enabled; `env_http_headers` is `{"authorization": "AI_LORE_MCP_HEADER"}` as set, so the token stays in the environment. | Pass |
| 2 to 5 (a real session: guard, sandbox, session tools) | Not run: `codex login status` answered "Not logged in" on 2026-09-19. | Skipped |

## OpenCode, phase M10.8

| Check | Observed | Result |
|---|---|---|
| `command -v opencode`, `opencode auth list` | Not found; exit 1 and 127. | Skipped |
| All real-engine checks | Not run: opencode was not found on the PATH on 2026-09-19. The configuration, the guard plugin and the Python hook are covered by headless tests, one of which loads the generated plugin and runs it against the real check scripts. | Skipped |

## Tester's review of the three adapters

The independent tester of M10.6 to M10.8 found two defects in the Antigravity adapter and fixed them. A hook input with a missing or malformed `toolCall` was answered "ask"; it now raises a fault and is refused, as for the other engines. The session server was recognised when `ServerName` contained `ailore`, so a server of the user's own agy configuration with a similar name would have been allowed; it now must equal `lore_ailore`. The tester ran the Claude Code hooks of this change and of the previous commit side by side on 17 inputs; all outputs and exit codes were identical.

## State on 2026-09-19 before M10.9

- Codex: the Human Lead signed in (`codex login status` answers `Logged in using ChatGPT`). M10.9 runs checks 2 to 5.
- OpenCode: installed by the Human Lead, who chose not to sign in for now. It stays unguarded; its checks wait until a sign-in.
- Antigravity: the Human Lead switched agy to an account with quota; a one-prompt run answered without a quota error. M10.9 runs the deny-rule check, checks 5 and 6, and check 4 again with `--uncovered-shell deny`.
- `guardedSessions` is set to true in the catalog only for an engine whose checks passed (ruling 5 of section 1 of the architecture document).
