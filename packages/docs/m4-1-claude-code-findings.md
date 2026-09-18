# M4.1 — what Claude Code enforces: findings

Written 2026-09-18 for phase M4.1 of the MVP focus. Status: not reviewed by the Human Lead. It answers the questions in row M4.1 of section 9 of `mvp-architecture.md` with what the real engine did, so that M4.3, M4.4, M4.5 and M4.8 are built on observed behaviour.

## How the investigation was run

The engine is Claude Code 2.1.276 on macOS, signed in with a claude.ai account. Every run was headless: `claude -p <prompt> --model haiku --no-session-persistence --output-format stream-json --verbose`, with every setting passed on the command line. Eleven runs were made. Each prompt told the session exactly which tool calls to make, in order, without retrying.

The runs used a temporary Space built by `makeSpaceFixture` from `packages/spec/lore-1.0/`, with two repositories (`app` and `lib`, both checked out on `main`), a desk with two sessions (`s-ro` in Read only; `s-wr` in Writing with claims on `app` at branch `main` and on `lib` at branch `item-7-other`), and the plugin and check scripts written by `installClaudeCode`. The Space, the desk and the hook scripts are under a folder named `with space`, and the desk under `user data`, so every generated path holds a space.

Everything is kept in the scratch folder, written `<M41>` below:
`/private/tmp/claude-501/-Users-albertogutierrez-volatile-alberto-conan-ui-ai-lore-companion/ad4f8801-e671-4526-91fa-8cc8828d2375/scratchpad/m4-1/`

| Kept file | What it is |
|---|---|
| `<M41>/setup.mjs`, `<M41>/space.json` | The script that built the Space, the desk and the install, and the paths it produced |
| `<M41>/run.sh` | The wrapper every run went through; it refuses a working directory outside `<M41>` |
| `<M41>/runs/<run>.cmd`, `.jsonl`, `.stderr` | The exact command of each run, its full output stream, its standard error |
| `<M41>/settings/<run>.settings.json`, `<M41>/settings/mcp.json` | The settings file and the MCP configuration of each run |
| `<M41>/prompts-*.txt` | The prompt of each run |
| `<M41>/with space/session files/hooks/` | `pre-write.py` (the adapter), `codes.py`, `sandbox-flip.py`, `perm-flip.py` |
| `<M41>/logs/` | What each hook received on standard input, and the MCP server's log of headers and timings |
| `<M41>/mcp-server.mjs` | The minimal MCP server |

The runs, by name: `run-a` (Read only session, working directory the Space), `run-b` (Writing session, working directory `repos/app`), `run-shell` and `run-shell2` (shell commands under an allow list), `run-patterns` (wildcard rules, without the user's settings), `run-sandbox`, `run-reload`, `run-plugin`, `run-mcp1`, `run-mcp2`, `run-mcp3`.

Labels: **Observed** names the run that showed it. **Documented** was read in the help text or at `code.claude.com/docs` on 2026-09-18 and was not observed. **Unknown** was neither.

## 1. `--settings`: added to the other settings, or replacing them

- **Observed (`run-a`, `run-plugin`).** A per-run settings file is added to the user's settings. The user's enabled plugin (`frontend-design`) was loaded in every run that did not exclude it.
- **Observed (`run-a`).** For a single value the per-run file is used in place of the user's. The user's settings on this machine hold `permissions.defaultMode: "auto"`. With `"defaultMode": "default"` in the per-run file, the session reported `permissionMode: "default"`. A per-run file that does not set `defaultMode` was not tried; the user's `auto` would then be expected to apply.
- **Observed (`run-a`).** A `.claude/settings.json` inside the working directory (placed in the scratch Space for this run only) is also read. Its `PreToolUse` hook ran for every matching call, beside the per-run hook. Its `permissions.allow` entry was ignored, and the engine printed that the workspace is not trusted. Hooks from a Space's own `.claude/` folder therefore run in a headless companion session even when the folder is not trusted.
- **Observed (`run-patterns`).** `--setting-sources project,local` leaves the user's settings out: the plugin list was empty.
- **Observed (`run-a`, `run-b`).** `PreToolUse` hooks from the per-run file fire in headless mode for `Write`, `Edit`, `NotebookEdit` and `Bash`.
- **Observed (tool list of every run).** Claude Code 2.1.276 has no `MultiEdit` tool. A matcher that names it does no harm.
- **Observed (`run-a`, `run-b`).** `NotebookEdit` checks its own input before the hook runs: a call on a notebook the session had not read failed with "File has not been read yet" and the hook was not called. After a `Read` the hook was called.
- **Observed (`run-reload`, `run-sandbox`).** A change to the per-run settings file during the session did not take effect: an allow rule added after the first call was not applied five seconds later, and a sandbox path moved from `denyWrite` to `allowWrite` was not applied seven seconds later. **Documented**: the hooks page says edits to settings files are picked up by a file watcher. That was not what these two runs showed for the file given by `--settings`. Longer waits and interactive sessions were not tried.

## 2. The hook's input and its refusal

**Observed (`run-a`, `run-b`; `<M41>/logs/hook-s-ro.jsonl`, `hook-s-wr.jsonl`).** The JSON a `PreToolUse` hook receives on standard input has these fields: `session_id` (the engine's own UUID), `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`. `tool_input` holds `file_path` and `content` for `Write`; `file_path`, `old_string`, `new_string`, `replace_all` for `Edit`; `notebook_path`, `cell_id`, `new_source` for `NotebookEdit`; `command` (and `description` when the model gives one) for `Bash`. The hook process runs with the session's working directory as its own, and the environment variable `CLAUDE_PROJECT_DIR` holds the same folder. `session_id` is not the companion's session id, so the hook command has to carry the companion's id as an argument, as section 5.6 already has it. **Documented** (help text): `--session-id <uuid>` sets the engine's id; not tried.

What each way of ending the hook does, **Observed (`run-b`, hook `codes.py`)**:

| The hook | Result |
|---|---|
| exits 2 with a reason on standard error | The call is blocked. The model receives `PreToolUse:Write hook error: [<the whole hook command>]: <the reason>`. The whole hook command is included, so the model reads the desk folder's path, the checks folder's path and the companion's session id. |
| exits 0 and prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` | The call is blocked. The model receives only the reason. |
| exits 0 and prints the same with `"permissionDecision":"allow"` | The call runs without a permission rule for the tool. An `Edit` that was denied in `run-a` for lack of a rule ran in `run-b`. |
| exits 0 and prints nothing | The call goes on to the engine's permission rules. It does not grant permission: in `run-a` the write-guard allowed an `Edit` in the Workbench and the engine then denied it, because no rule allowed `Edit` and a headless run has nobody to ask. |
| exits 1, or exits 3 | The call is not blocked. The file was written. |
| runs longer than its `timeout` (5 seconds configured, the script slept 15 and would have exited 2) | After 5 seconds the call is not blocked. The file was written. |

**Documented.** The default timeout of a command hook is 600 seconds. Exit 2 cannot be overridden by a JSON `allow`. A command that cannot be started (for example `python3` missing, exit 127) is "any other exit code" and does not block; not observed.

**The adapter** is `<M41>/with space/session files/hooks/pre-write.py`. It reads the JSON, takes `tool_input.file_path` or `tool_input.notebook_path`, makes a relative path absolute against `cwd`, and runs `python3 <checks>/write-guard.py --space --desk --session --path --when before` with an argument list. It passes on exit 0, and on a refusal it writes the script's standard error and exits 2. A missing script or an exception inside the adapter exits 2. The four cases, **Observed** with the real engine:

| Run | Session | Write | Result |
|---|---|---|---|
| `run-a` | `s-ro`, Read only | `lore/m41-test.md` | Refused: "the path is in the Lore, and the session "s-ro" is in Read only, in which a session writes only to the Workbench." |
| `run-a` | `s-ro`, Read only | `workbench/scratch/m41-a.md` | Allowed; the file was created |
| `run-b` | `s-wr`, claims `app` on `main` | `repos/app/src/m41-new.ts` | Allowed; the file was created |
| `run-b` | `s-wr`, claims `lib` on `item-7-other`, `main` checked out | `repos/lib/src/m41-new.ts` | Refused: "the session "s-wr" claimed the repository "lib" on the branch "item-7-other", and the branch checked out is "main"." |

In `run-b` the second write was outside the session's working directory (`repos/app`); the engine raised no objection of its own with `Write` in the allow list.

## 3. A hook command with a space in its path, from any working directory

**Observed (`run-a`, `run-b`).** The command `python3 "<M41>/with space/session files/hooks/pre-write.py" --space "<…>/with space/…" --desk "<…>/with space/user data/…" --session s-wr …` ran correctly with the Space as working directory and with `repos/app` as working directory. Double quotes around each path are enough. A path with a single quote was not tried; that is M4.4's headless test.

## 4. The shell

The settings of `run-shell2` hold `defaultMode: "default"` and an allow list: `Read`, `Grep`, `Glob`, `Write`, `Edit`, `NotebookEdit`, `Bash(ls:*)`, `Bash(cat:*)`, `Bash(git status:*)`, `Bash(git fetch:*)`, `Bash(git log:*)`, `Bash(git diff:*)`, `Bash(git branch:*)`, `Bash(git rev-parse:*)`, `Bash(git symbolic-ref:*)`, four `gh issue` and `gh project` prefixes, and the two skeleton generators. The session was `s-ro`, which holds no claim, so every write below is outside its claim. In a headless run, a command that would ask is denied; in the companion's terminal it would ask the Human Lead.

| Command | **Observed (`run-shell2`)** |
|---|---|
| `echo x > lore/…`, `git status > lore/…` | Denied. The engine reads the redirection and treats it as a file write: "Output redirection to … was blocked". The message names the Space as the allowed folder although the path is inside it, and `Edit` was in the allow list. Why it was blocked is **Unknown**. |
| `git status && touch lore/…` | Denied for the `touch` part. A compound command is split and each part is checked. |
| `echo x \| tee lore/…` | Denied: "the following part requires approval: tee …" |
| `python3 -c "open('lore/…','w').write('x')"` | Denied: requires approval |
| `git -C repos/app checkout -b m41-other` | Denied: requires approval |
| `git log -1 --output=lore/m41-bash-9.md` | **Ran. The file was written in the Lore by a Read only session.** The rule `Bash(git log:*)` matches the prefix and the option writes a file. |
| `git branch m41-created` | Ran. The branch was created in the Space's repository. |

- **Observed (`run-shell2`, `run-patterns`).** A rule `Bash(<text>:*)` matches commands that begin with the text. `Bash(git status:*)` does not match `git -C repos/app status`. A rule may hold `*` elsewhere: `Bash(git -C * status*)` allowed `git -C repos/app status --short` and did not allow `git -C repos/app log` or `git -C repos/app checkout`. A `deny` rule is applied before an allow rule: `Bash(git log*--output*)` in `deny` blocked the write above while `git log -1 --oneline` still ran.
- **Observed (`run-shell`).** An `ask` rule is applied before the allow rules. With `"ask": ["Bash"]` in the settings every Bash command was denied, the allow-listed ones included. Without the rule, a command that no rule allows asks by default (`run-shell2`).
- **Observed (`run-a`).** Some commands run with no rule at all. `echo other: hello` ran in default mode with no matching rule.
- **Observed (`run-shell2`).** `cd repos/app && git status` is denied with its own message: the command changes directory before a version-control command.
- **Observed (`<M41>/logs/hook-shell2.jsonl`).** A `PreToolUse` hook on `Bash` receives the command's text in `tool_input.command`, and nothing about the files the command will write.

**Sandbox settings.** **Observed (`run-sandbox`).** They can be given per run: `sandbox.enabled`, `sandbox.filesystem.allowWrite` and `denyWrite` with absolute paths, in the `--settings` file. With `lore/`, `repos/` and `publish/` in `denyWrite`, the operating system refused `python3 -c "open('lore/…','w')"` ("Operation not permitted") and `git -C repos/app checkout -b …` ("Unable to create … .lock: Operation not permitted"), and a write in `workbench/` succeeded. With the sandbox on, Bash commands ran without asking and without an allow rule (`autoAllowBashIfSandboxed` was `true`), so the allow list has no effect in that configuration. The sandbox did not follow a change: the hook rewrote the settings file during the session so that `lore/` was allowed, and the next write to `lore/` was still refused. Sandbox settings therefore apply from the start of the engine process and not from a claim granted later. Whether `gh` reaches GitHub under the sandbox's network rules is **Unknown**.

**What the write-guard can and cannot stop.** It stops the engine's file tools (`Write`, `Edit`, `NotebookEdit`) by path, in both modes, including the branch rule. It cannot stop any shell command, because the hook sees only text. The permission rules deny or ask for the plain forms (`>`, `tee`, `touch`, `python3 -c`, `git checkout`), and they let through any write that an allow-listed prefix can make (`git log --output=`, `git branch`, and by the same reasoning `gh issue comment`, which is wanted). Only the sandbox stops shell writes by path, and it is fixed when the engine starts.

## 5. `--plugin-dir`

- **Observed (`run-plugin`).** With `--plugin-dir <install>/claude-code/plugin` the session lists the fifteen skills as `lore:<name>` in its slash commands. `claude -p "/lore:work-report <extra text>"` invokes the skill in headless mode, and the extra text reaches the session after the skill's text.
- **Observed (`run-plugin`).** The generated skill gives the card's absolute path. With `repos/app` as working directory the session read `<Space>/lore/verbs/default/work-report.md` at that path, with `Read` in the allow list. The relative path in the skill text works only from the Space's folder; the absolute one works from anywhere.
- A note for callers: `installClaudeCode(lore, dir)` adds `claude-code/` itself. `setup.mjs` passed `<install>/claude-code` and got `<install>/claude-code/claude-code/plugin`.

## 6. MCP over HTTP to a local server

The server (`<M41>/mcp-server.mjs`) uses the SDK as `mcp-host.ts` does: stateless, a direct JSON response, bound to `127.0.0.1` on a port the operating system chose. The configuration was `{"mcpServers":{"ailore":{"type":"http","url":"http://127.0.0.1:<port>/mcp/s-ro","headers":{"Authorization":"Bearer <token>"}}}}`.

- **Observed (`run-mcp1`, `<M41>/logs/mcp-server.jsonl`).** Every request carries `host: 127.0.0.1:<port>` and the configured `authorization` header, from the first request on. No request carries an `Origin` header. Other headers: `user-agent: claude-code/2.1.276 (sdk-cli)`, `accept: application/json, text/event-stream`, `mcp-protocol-version`. The rules of section 5.14 fit the engine's client.
- **Observed (`run-mcp1`).** The client's requests at start are, in order: `POST server/discover` (a method the SDK 1.29.0 server does not know; it answered with an error and the client went on), `POST initialize`, `POST notifications/initialized`, `GET` on the same path (answered 405; the client went on), `POST tools/list`. The server was reported `connected`.
- **Observed (`run-mcp1`).** With no timeout configured, a call held for 30 seconds returned its answer. A call held for 90 seconds was abandoned by the client after 60.0 seconds with "The operation timed out." **Documented**: for an HTTP server there is a timer on each request up to the first byte of the response, set to the greatest of 60 seconds, the tool timeout that applies to the server, and `MCP_TIMEOUT`. A direct JSON response sends no byte until the answer, so this timer decides.
- **Observed (`run-mcp2`).** With `"env": {"MCP_TOOL_TIMEOUT": "400000"}` in the per-run settings, a call held for 90 seconds returned its answer. A call held for 330 seconds was abandoned after 300 seconds: "sent no response or progress for 300s; aborting". This is the five-minute idle limit section 4.3 cites. **Documented**: a `"timeout"` in milliseconds on the server's entry in the MCP configuration sets the tool timeout for that server and is also the lowest value the idle limit takes; `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes the idle limit. Neither was tried.
- **Observed (`run-mcp3`).** With the server not running the session starts normally. The server's status is `failed`, no `mcp__ailore__*` tool exists, and the model is told "Unable to connect". Whether the client connects again when the server appears later is **Unknown**.
- **Observed (`run-mcp1`).** MCP tools are loaded on demand: the model called `ToolSearch` with `select:mcp__ailore__await_answer` before its first call. `--allowedTools mcp__ailore__await_answer` let the call run without asking.

## 7. Whether the allow list lets the default verbs run

`session-orient` and `work-report` name few exact commands. They need: reading files (the `Read` tool); `python3 lore/mirrors/generators/folder-skeleton.py <folder>` and `repository-skeleton.py repos/<name>`; reading the plan and the Agents board with `gh` (`gh issue view`, `gh issue list`, `gh project item-list`, `gh project field-list`); `git fetch`; for `work-report`, the state of a branch in a repository (`git status`, `git log`, `git diff`, run on `repos/<name>`), the item's tests, and `gh issue comment`. The Lore's other cards also name `git rev-parse --show-toplevel`, `git symbolic-ref`, `git remote set-head origin --auto` and `gh issue develop`.

**Observed (`run-shell2`, `run-patterns`).** Under the allow list of part 4, from the Space's folder: `git fetch` ran; `python3 lore/mirrors/generators/folder-skeleton.py publish` ran and printed the skeleton; `gh issue view 1 --repo octocat/Hello-World --json title` ran. `git -C repos/app status --short` was denied, and so was `cd repos/app && git status --short`, so a session whose working directory is the Space cannot read a repository's state with the prefix rules alone. Adding `Bash(git -C * status*)` allowed it. `gh project item-list` was allowed by the rules and failed for another reason: the `gh` token on this machine lacks the scope `read:project`. Running an item's tests is not covered by any rule and would ask each time.

## 8. `claude auth status --json` when signed out

Not tested: signing out was excluded. **Observed**, signed in: exit code 0 and a JSON object with `loggedIn: true`, `authMethod`, `apiProvider`, `subscriptionType`, `email`, `orgId`, `orgName`, `configDirectory`, `projectsDirectory`. **Documented**: `claude auth status --help` says only "Show authentication status", `--json` "Output as JSON (default)", `--text` "Output as human-readable text". The signed-out output and exit code are **Unknown**. `machine/engine-sign-in.ts` already trusts only a boolean `loggedIn`, which fits.

## What this changes in the design

| # | Finding | Where | Smallest change |
|---|---|---|---|
| 1 | The client abandons a silent HTTP tool call after 60 seconds unless a tool timeout is set; with one set, after 300 seconds of silence | Section 4.3 (`await_answer`, 120 seconds); M4.3, M4.4, M4.5 | M4.4 writes `"env": {"MCP_TOOL_TIMEOUT": "<ms>"}` in the session's `settings.json` (observed to work) or `"timeout"` on the server entry in `mcp.json` (documented), with a value above the wait. M4.3 keeps the wait of `await_answer` at 120 seconds, below 300. If neither setting is wanted, the wait has to be under 60 seconds, for example 45. M4.8 tests one pending answer of the full wait with the real engine. |
| 2 | Exit codes other than 2, and a hook that reaches its timeout, let the write happen | Section 5.6 ("when `python3` is missing it refuses") ; M4.4 | The adapter catches every error and exits 2. Each hook entry sets `timeout` explicitly and well above the write-guard's own 10-second `git` timeout (30 seconds is enough). The sentence about a missing `python3` is corrected: the adapter cannot refuse when it cannot start, so the companion checks `python3` before it starts a session (the machine check already requires it) and does not start one without it. |
| 3 | A hook that exits 0 does not grant permission; a JSON `allow` does | Section 5.6, the session's `settings.json`; M4.4 | Two ways, M4.4 picks one. (a) `Write`, `Edit`, `NotebookEdit` in `permissions.allow`, the hook only refuses. (b) No allow rule for them; the adapter prints `permissionDecision: "allow"` when the write-guard allows. With (b), if the hook ever fails without blocking, the engine asks the Human Lead instead of writing. This document recommends (b). |
| 4 | An exit-2 refusal shows the model the whole hook command | Section 5.6; M4.4 | The adapter refuses with the JSON `deny` form and the write-guard's sentence as the reason, which keeps "the refusal names the mode". Exit 2 stays for the adapter's own failures. The desk's path is then not given to the session by a normal refusal. |
| 5 | The user's `defaultMode` can be `auto`; the per-run value is used in its place | Section 5.6; M4.4 | The session's `settings.json` always sets `permissions.defaultMode` to `"default"`. It holds no `ask` rule for `Bash`, because that rule defeats the allow list. M4.4's headless test asserts both. |
| 6 | Prefix rules do not match `git -C <repo> …`; `cd <repo> && git …` is refused | Section 5.6 allow list; M4.4; the default verbs of M1 | The allow list adds `Bash(git -C * status*)`, `Bash(git -C * log*)`, `Bash(git -C * diff*)`, `Bash(git -C * fetch*)`, `Bash(git -C * rev-parse*)`, and the verb cards tell the session to use `git -C repos/<name>`. |
| 7 | An allow-listed prefix can write a file (`git log --output=`), and `git branch` creates a branch | Section 5.6 table, section 10.2 risk row; M4.4 | `permissions.deny` adds `Bash(git *--output*)`; `Bash(git branch:*)` is replaced by `Bash(git branch --show-current*)` and `Bash(git branch --list*)`. The UI text of section 5.6 stays: shell commands are limited by the engine's rules and not by the write-guard. |
| 8 | Sandbox settings work per run, are enforced by the operating system, make Bash run without asking, and do not follow a change during the session | Section 5.6 last paragraph of "Shell commands"; section 10.2 | The question is answered: the sandbox cannot follow a claim. No change for the MVP. An option for the Human Lead, not designed here: start Read only sessions with `denyWrite` for `lore/`, `repos/` and `publish/`, and restart the engine when the mode changes; resuming a session and `gh` under the sandbox's network rules would have to be tested first. |
| 9 | `MultiEdit` does not exist; `NotebookEdit` uses `notebook_path` | Section 5.6 "File edits"; M4.4 | The adapter reads `file_path` or `notebook_path`. The matcher keeps `MultiEdit` for older engines. |
| 10 | Headers: `Host` is `127.0.0.1:<port>`, no `Origin`, the bearer token on every request; the client first sends `server/discover` and a `GET` | Section 5.14; M4.3 | No change to the rules. M4.3's headless test adds: an unknown method gets a JSON-RPC error and a `GET` gets 405, and neither counts as a refusal that ends the session. |
| 11 | When the server is not reachable the session starts without the four tools | Section 5.6; M4.4, M4.6 | M4.4 starts the local server before it spawns the engine (already the order in 5.6). `session-orient` step 2 already covers a session without the tools. |
| 12 | A Space's own `.claude/settings.json` adds hooks to a companion session | Section 5.6 "Sessions not started by the companion" | Stated as a limit. `--setting-sources` can leave the project's settings out; it also leaves out the Human Lead's own, so it is a decision for the Human Lead. |
| 13 | The `gh` token lacks `read:project` | Section 5.8 machine check; M3.5, M7 | No code change: `machine/gh-auth.ts` already reads the token's scopes. On this machine the Human Lead has to run `gh auth refresh` with the project scopes before a session can read the plan. |
| 14 | A headless run waits 3 seconds for standard input | M4.8 | The gate's real-engine test starts `claude -p` with standard input closed. |

## Limits the Human Lead should know about

- A session can write outside its claim through the shell. The write-guard does not see shell commands. The engine's rules stop the plain forms and ask for the rest; an approved or allow-listed command can write anywhere the user can.
- If the hook's process fails with an exit code other than 2, or exceeds its timeout, the engine lets the write happen. The adapter is written to avoid both, and option (b) of change 3 makes the engine ask in that case.
- The guards hold only for sessions the companion starts, and only while the Human Lead's own settings and the Space's `.claude/` folder do not add rules that allow more. Allow rules from the user's settings are added to the session's.
- All permission results here are from headless runs, where "ask" becomes "denied". The interactive prompt in the companion's terminal was not observed.
- The findings are for Claude Code 2.1.276. The timers of part 6 and the rule matching of part 4 have changed between versions according to the documentation.
- Every run of the engine writes under `~/.claude/` by itself: it created an empty folder per working directory under `~/.claude/projects/` (two were left by this investigation, both named after the scratch Space and holding only an empty `memory` folder), and it updates `~/.claude.json`. `--no-session-persistence` did not prevent the folder.
- Not tested: signed-out `auth status`; a path with a single quote; the sandbox with `gh`; the per-server `timeout` key; reconnection to the local server; `--session-id`; a settings reload after more than seven seconds.
- One run read a public GitHub issue (`octocat/Hello-World` number 1) with `gh` to see the permission decision. Nothing was written to GitHub.
