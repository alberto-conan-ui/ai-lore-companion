# M10 — every catalog engine in a Space: technical design and phase specifications

Written 2026-09-19 by the architect of stage M10 "polish and every engine in a Space" of the focus `mvp-ai-lore-1-0`. Status: not reviewed by the Human Lead. This document replaces the earlier `m10-architecture.md`, whose four sections were written before the Human Lead's rulings and are superseded. Phases M10.1 (colours) and M10.2 (install from the start control) are done and are not described again.

Inputs, in order of authority:

1. The Human Lead's rulings of 2026-09-19, as recorded in the stage file `M10-polish.stage.md` and restated in section 1.
2. `mvp-architecture.md`: the architecture, section 5.6 (sessions and the write-guard), the coding standards (section 6), the testing strategy (section 8) and the definition of done for a phase (section 8.7). Every phase follows them unless it says otherwise.
3. `onboarding-architecture.md`: A.9 and A.10 (the engine choice and its refusals), and the phase format of Part C, which Part 5 of this document uses.
4. `m4-1-claude-code-findings.md`: what Claude Code enforces, observed with the real engine.
5. `m10-polish-product.md`: the product notes written by the earlier session. Where they differ from the rulings, the rulings apply.

Section 1 states what M10 adds. Section 2 records what each engine supports, with evidence. Section 3 is the design. Section 4 lists the decisions this document makes and the Human Lead's answers to its questions. Section 5 is one specification per phase.

---

## 1. What M10 adds, and the rulings

Today a Space window starts guarded AI sessions with Claude Code only. A guarded session is started by the companion with files it generates for that session: a settings file with permission rules and two hooks that run the Lore's check scripts before and after each file write, an MCP configuration that connects the session to the companion's session server (the tools `request_writing`, `request_gate`, `await_answer`, `leave_writing`), and the Lore's verbs and processes as a Claude Code plugin of skills. `packages/app/src/main/space/sessions/` builds this; `command-line.ts` holds the Claude Code options (`engineArgv`), and `preflight.ts` refuses an engine entry whose arguments hold an option that would change the guard (`GUARD_CHANGING_ENGINE_OPTIONS`).

The Human Lead's rulings of 2026-09-19:

1. All four catalog engines run guarded Space sessions in the MVP: Claude Code (`claude`), Antigravity CLI (`agy`), Codex CLI (`codex`) and OpenCode (`opencode`). Gemini CLI is out of scope.
2. Each engine of the registry has a list of parameters, editable in Settings (the Engines section, which already has an Edit button). Each parameter can be marked "ticked by default". The start control (on the Dashboard and in Sessions) shows the chosen engine's parameters as checkboxes, with the defaults ticked, and the ticked ones are passed to the session. Example: Antigravity with `--dangerously-skip-permissions` ticked by default. This replaces the free-text "Parameters" field the earlier session added.
3. A session started with a guard-changing parameter is allowed. Its tab and its Dashboard entry are labelled "unguarded". Each engine has its own guard-changing options.
4. The start control shows, per engine, whether it reads the Lore as Claude Code does: (a) it gets the Lore's instructions and its verbs, (b) it has the session server's tools, (c) its writes are guarded.
5. `guardedSessions` in the catalog becomes true for an engine only when its adapter is built and tested.

The Human Lead's answers of 2026-09-19 to the questions of an earlier draft of this document:

6. Antigravity CLI gets `--dangerously-skip-permissions` as a parameter ticked by default, and for Antigravity that option is not guard-changing, because the Lore's `PreToolUse` hook was observed to refuse writes with it on (section 2.3). Guard-changing options are therefore per engine: each adapter declares its own list. Phase M10.9 confirms the observation with a real Antigravity run; if a hook refusal does not block, the option moves to Antigravity's guard-changing list (M10.9 item 4).
7. Codex CLI runs with `--sandbox read-only`.
8. Claude Code gets the session instructions with `--append-system-prompt`, in M10.5.
9. The Human Lead signs in to Codex CLI and installs OpenCode on this Mac, so M10.7 and M10.8 include the checks with the real engines. A check that finds Codex still signed out, or OpenCode not installed, is skipped with a line in the phase report and in the findings file.

What M10 adds, in one list:

- An engine parameter model in the registry (`EngineEntry.params`), with a migration of the existing `args`, edited in Settings (phase M10.3).
- Checkboxes for the chosen engine's parameters on the start control; the ticked ones travel to main by name and are checked there (M10.3).
- Per-engine option lists: options the companion sets itself (a parameter holding one is refused) and options that change the guard (the session starts and is labelled unguarded) (M10.3).
- The "unguarded" label on the session record, the session header, the tab title and the Agents board row (M10.3).
- An engine adapter interface in main, with Claude Code moved behind it, a short set of session instructions given to every engine, and the Lore readiness report on the start control (M10.5).
- One adapter per other engine: Antigravity CLI (M10.6), Codex CLI (M10.7), OpenCode (M10.8).
- The checks with the real engines, the catalog flags, and the end-to-end tests (M10.9).

---

## 2. Findings per engine

### How the findings were made

Labels used in this section:

- **Observed**: seen in a run of the installed engine on 2026-09-19, named by run.
- **Checked**: read in the engine's help text (the command is given) or on its official documentation (the URL is given), and not run.
- **Unverified**: neither; stated as what the design assumes, to be observed in the engine's phase.

Installed on this machine: Claude Code (`~/.local/bin/claude`), Antigravity CLI 1.2.7 (`~/.local/bin/agy`, signed in), Codex CLI 0.155.0 (`/opt/homebrew/bin/codex`, `codex login status` answers `Not logged in`). OpenCode is not installed, so every OpenCode finding is Checked from its documentation or Unverified.

The runs were made in a scratch folder of this session (`/private/tmp/claude-501/-Users-albertogutierrez-volatile-alberto-conan-ui-ai-lore-companion/265a937b-1dc6-4d65-9557-b3342b4dfdb5/scratchpad/`, written `<S>` below; it is temporary):

- `<S>/agy/`: a git repository `space/` with `lore/note.md` and `workbench/`, a session folder `sess/` (and a copy `zsess/`) holding `.agents/plugins/lore/` with `plugin.json`, `rules/AGENTS.md` (a marker sentence `RULEMARK-42`), `skills/lore-probe/SKILL.md` (a marker `SKILLMARK-C`), `hooks.json` (one `PreToolUse` hook, matcher `*`, running `hook.py`) and `mcp_config.json` (the address of a local MCP server with a bearer header). `hook.py` logged its standard input and answered `deny` for any call whose arguments hold `lore/`, and `allow` otherwise. The MCP server was the minimal server of phase M4.1 (`mcp-server.mjs`), which logs every request. Runs `runA` to `runF` were headless (`agy -p "<prompt>" … --print-timeout 240s`, standard input closed), with outputs in `<S>/agy/logs/`.
- `<S>/cx/`: a git repository `space/` with an `AGENTS.md` holding a marker, and `.agents/skills/lore-test/SKILL.md`. Codex was run only with commands that need no sign-in: `codex debug prompt-input`, which prints the input the model would receive, and `codex mcp list` / `codex mcp get`.

### 2.1 Summary table

| | Claude Code | Antigravity CLI (`agy`) | Codex CLI (`codex`) | OpenCode (`opencode`) |
|---|---|---|---|---|
| Version looked at | 2.1.276 to 2.1.277 (M4.1, M4.4) | 1.2.7 | 0.155.0 | none installed |
| Instructions for one session, outside the Space | Checked: `--append-system-prompt <prompt>` (`claude --help`) | Observed: a plugin's `rules/AGENTS.md` in a folder given with `--add-dir` (`runC`) | Observed: `-c developer_instructions="<text>"` appears as the first developer message (`codex debug prompt-input`) | Checked: `instructions` (list of file paths) in a config file named by `OPENCODE_CONFIG` (opencode.ai/docs/rules, /docs/config) |
| Verbs for one session | Observed: skills of `--plugin-dir` as `/lore:<name>` (M4.1) | Observed: the plugin's `skills/<name>/SKILL.md` is listed to the model (`runC`) | Not found for one session. Observed: skills are found in `.agents/skills/` of the working folder (`codex debug prompt-input`); docs list no per-session path (learn.chatgpt.com/docs/build-skills). The verbs can be listed in the instructions. | Checked: custom commands `commands/<name>.md` in the folder named by `OPENCODE_CONFIG_DIR`, invoked as `/<name>` (opencode.ai/docs/commands, /docs/config) |
| Session server (MCP over HTTP) for one session | Observed: `--mcp-config <file> --strict-mcp-config` (M4.1) | Observed: the plugin's `mcp_config.json` with `serverUrl` and `headers`; the client sent the bearer header and listed the tools (`runA`) | Observed (configuration only): `-c mcp_servers.ailore.url=…`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `tool_timeout_sec` are accepted and shown by `codex mcp list/get -c …`; not connected to a server here | Checked: `mcp.<name>` with `type: "remote"`, `url`, `headers`, in the `OPENCODE_CONFIG` file (opencode.ai/docs/mcp-servers) |
| Check of a file write by path, before it happens | Observed: `PreToolUse` hook for `Write`, `Edit`, `NotebookEdit` (M4.1) | Observed: the plugin's `PreToolUse` hook receives `toolCall.name` and `toolCall.args.TargetFile` for `write_to_file` and `replace_file_content`; `{"decision":"deny","reason":…}` blocked the write and the model received the reason, also under `--dangerously-skip-permissions` (`runA`, `runC`, `runF`) | Checked: `PreToolUse` hooks fire for `apply_patch` (matched as `apply_patch`, `Edit` or `Write`); `tool_input.command` holds the patch text; deny by JSON or exit 2; a timeout or another exit code lets the call go on (learn.chatgpt.com/docs/hooks). Observed: `-c hooks.PreToolUse=[…]` is read and type-checked as the hooks table (`codex debug prompt-input`: a wrong type is refused with "expected a sequence in `hooks`", a list is accepted). Not observed firing. | Checked: a plugin's `tool.execute.before` receives the tool name and its arguments (`filePath` for `edit` and `write`, `patchText` for `apply_patch`) and blocks the call by throwing (opencode.ai/docs/plugins; tool arguments from the source files `packages/opencode/src/tool/*.ts`). Not observed. |
| Shell commands | Engine permission rules in the session's settings (M4.1, M4.4) | Observed: `run_command` reaches the same hook with `CommandLine` and `Cwd`; a hook `deny` blocked it (`runF`). The hook sees text only. | Checked: an OS sandbox, `--sandbox read-only | workspace-write | danger-full-access`, and `--ask-for-approval on-request | never` (`codex --help`) | Checked: `permission.bash` patterns with `allow`, `ask`, `deny` (opencode.ai/docs/permissions). No sandbox. |
| The Human Lead's own configuration can be left out | Yes: `--setting-sources ''` (M4.4) | No option found. Global rules, skills, plugins and `~/.gemini/antigravity-cli/settings.json` (which holds the Human Lead's own `permissions.allow` list) are read (installed guide `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/SKILL.md`). | No for the interactive program: `--ignore-user-config` and `--ignore-rules` exist for `codex exec` only; `codex --ignore-user-config` fails with "unexpected argument" (Observed). The user's `config.toml` MCP server `nx-mcp` was listed beside the per-run one (Observed, `codex mcp list`). | No: `~/.config/opencode/` is always read; a proposal to skip it was closed unmerged (GitHub anomalyco/opencode PR #10013, Checked). |
| Options that change the guard | `GUARD_CHANGING_ENGINE_OPTIONS` today | `--mode`, `--add-dir` (`agy --help`). Not `--dangerously-skip-permissions`: the hook still refuses with it on (Observed; answer 6) | `--dangerously-bypass-approvals-and-sandbox`, `-s/--sandbox`, `-a/--ask-for-approval`, `--add-dir`, `-p/--profile`, `-c/--config`, `--enable`, `--disable`, `--approve-for-me`, `-C/--cd`, `--remote` (`codex --help`) | `--auto`, `--agent`, `--pure` (opencode.ai/docs/cli) |
| Sign-in check | `claude auth status --json` | none (`signInCheck: none`) | `codex login status` (Observed: prints `Not logged in`, exit code 0; so the exit code does not tell signed-in from signed-out) | `opencode auth list` |

### 2.2 Claude Code

Claude Code is the reference: "reads the Lore as Claude Code does" means what a Claude Code session gets today, plus the session instructions of section 3.3.

- **Instructions.** Today a Claude Code session gets no instruction from the companion; the Space has no `CLAUDE.md`, and the session learns of `ai_readme.md` only if the Human Lead types it or runs `/lore:session-orient`. Checked (`claude --help`): `--append-system-prompt <prompt>` appends text to the system prompt. Section 3.3 proposes to use it.
- **Verbs, tools, guard.** Unchanged from `mvp-architecture.md` section 5.6 "As built" and the M4.1 findings.
- **`--dangerously-skip-permissions` and hooks.** Unverified: whether a `PreToolUse` hook's `deny` still blocks a write when the session runs with `--dangerously-skip-permissions`. The Claude Code documentation says hooks run in every permission mode; it was not observed. Phase M10.9 observes it, because ruling 3 lets a session start with that option.
- **Options that the companion sets and a parameter must not set again.** `--settings`, `--setting-sources`, `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, `--allowedTools` (`--allowed-tools`) and, from M10.5, `--append-system-prompt`. Checked (`claude --help`): `--bare` skips hooks and plugin sync, and `--safe-mode` starts with plugins, hooks and MCP servers turned off. A session with either would have no Lore and no guard; this document treats them as options the companion refuses (section 4, decision 4).
- **Options that change the guard.** `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--permission-prompt-tool`, `--tools`, `--add-dir`.

### 2.3 Antigravity CLI

Evidence: `agy --help`, `agy mcp --help`, `agy mcp add --help`, `agy plugin --help`; the guide that ships with the program, `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/SKILL.md` and its `docs/hooks.md`, `docs/plugins.md`, `docs/mcp_servers.md`, `docs/rules.md`, `docs/skills.md`, `docs/json_configs.md` (Checked; written "the installed guide" below); runs `runA` to `runF`.

- **Where customisations are found.** Checked (installed guide): rules (`GEMINI.md`, `AGENTS.md`), skills, plugins and `hooks.json` are found in `.agents/` (or `.agent/`, `_agents/`, `_agent/`) of a workspace folder, walking up to the repository root, and globally in `~/.gemini/config/`. A plugin is a folder `plugins/<name>/` with `plugin.json`, and optional `rules/`, `skills/`, `hooks.json` and `mcp_config.json`, all loaded when the plugin is enabled. No command-line option or environment variable names another customisation folder (`agy --help`; the binary holds no such variable name).
- **One session's plugin, outside the Space.** Observed (`runA`): with `--add-dir <S>/agy/sess` and the working folder `space/`, the plugin in `sess/.agents/plugins/lore/` was loaded: its hook ran and its MCP server was connected. With `--add-dir` given, the working folder was not a workspace folder: the hook's input listed only `sess/` in `workspacePaths`, and the model wrote a relative path into `sess/`. Observed (`runE`): with `--add-dir <space> --add-dir <session folder>`, both are workspace folders in that order, the Space is the first, a relative path is written into the Space, and the plugin in the session folder is loaded. So a session is started as `agy --add-dir <Space> --add-dir <session folder>`, and nothing is written into the Space or into `~/.gemini`. The session folder becomes a workspace folder of the session; the write-guard refuses a write there, as it refuses any path outside the Space.
- **Instructions.** Observed (`runC`): the model quoted the sentence of the plugin's `rules/AGENTS.md`. Checked (installed guide, `docs/rules.md`): a rule file is capped at 24,000 bytes.
- **Verbs.** Observed (`runC`): the plugin's skill `lore-probe` was listed to the model. How the Human Lead invokes a plugin skill in the terminal (`/<name>` or a name with the plugin's prefix) is Unverified; the documentation site says skills are shown as `/<name>` (antigravity.google/docs/migration/workflows-to-skills, Checked by the research agent).
- **Session server.** Observed (`agy mcp add --header "Authorization: Bearer T0K" ailore http://127.0.0.1:9/mcp/s-1` run with `HOME` set to a scratch folder): the configuration form is `{"mcpServers":{"ailore":{"serverUrl":"<url>","headers":{"Authorization":"Bearer <token>"},"disabled":false}}}`. Observed (`runA`, the server's log): the client sent `server/discover`, `initialize`, `notifications/initialized`, `GET`, `tools/list`, each `POST` with the bearer header, user agent `Go-http-client/1.1`. Observed (`runC`): the model named the tool `await_answer` "from the `lore_ailore` MCP server", so the plugin's servers are prefixed with the plugin's name. The exact tool name the model calls, and how long the client waits for a silent tool call, are Unverified.
- **The hook.** Checked (installed guide, `docs/hooks.md`): `PreToolUse` handlers get JSON on standard input (`toolCall.name`, `toolCall.args`, `stepIdx`, `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`) and print `{"decision":"allow"|"deny"|"ask"|"force_ask","reason":…,"permissionOverrides":[…]}`; the command runs with `sh -c` in the folder that holds `hooks.json`; the default timeout is 30 seconds. Observed: the file tools are `write_to_file` (`TargetFile`, `CodeContent`, `Overwrite`) and `replace_file_content` (`TargetFile`, `TargetContent`, `ReplacementContent`, `StartLine`, `EndLine`, `AllowMultiple`); the reading tool is `view_file` (`AbsolutePath`); the shell tool is `run_command` (`CommandLine`, `Cwd`, `WaitMsBeforeAsync`) (`runF`). Tool names found in the binary and not observed: `multi_replace_file_content`, `edit_notebook`, `create_file`, `edit_file`, `delete_file`, `move_file`.
- **Allow does not grant in headless mode.** Observed (`runA`, `runB`): a hook `allow`, with or without `permissionOverrides: ["write_file(<path>)"]`, did not stop the headless run from refusing the write for lack of a `write_file` permission ("a tool required the "write_file" permission that headless mode cannot prompt for"). Whether `allow` grants in the interactive program is Unverified. The design does not depend on it: a write the adapter allows is then decided by the engine's own permission flow, which asks the Human Lead in the terminal.
- **`--dangerously-skip-permissions`.** Observed (`runC`, `runE`, `runF`): with it, the hook still ran and its `deny` still blocked `write_to_file`, `replace_file_content` and `run_command`. So on Antigravity this option removes the engine's own questions and leaves the write-guard's refusals in place. By the Human Lead's answer 6 it is therefore not a guard-changing option for Antigravity, and a session started with it is guarded; M10.9 confirms this with a real run.
- **What happens when the hook fails** (exit code other than 0, no JSON, timeout) is Unverified. The adapter is written as the Claude Code one: it always prints a decision, and refuses by itself before its timeout.
- **The Human Lead's own settings.** `~/.gemini/antigravity-cli/settings.json` on this machine holds a `permissions.allow` list (for example `command(git commit)`). No option leaves it out. Whether a hook's `force_ask` asks even for a command that list allows is Unverified.
- **After a write.** Checked (installed guide): a `PostToolUse` handler receives `stepIdx` and `error` and must print `{}`; it cannot send a message to the model. So a lore-integrity failure after a write cannot be reported to an Antigravity session through that hook.

**What an Antigravity session can be given, and what not.** Instructions, verbs as skills, the session server, and the before-write check of every file tool by path: yes, per session, outside the Space. The shell: the adapter sees each command's text and can allow the same fixed read commands as the Claude Code allow list, refuse the same deny patterns, and answer `force_ask` for any other command; that is the same kind of limit as Claude Code's (the text, not the files written). The Human Lead's own Antigravity allow list cannot be left out. The after-write report of lore-integrity cannot be given. The readiness report therefore says "partly" for the guard (section 3.6).

### 2.4 Codex CLI

Evidence: `codex --help`, `codex exec --help`, `codex mcp --help`, `codex mcp add --help`, `codex plugin --help`, `codex debug --help`, `codex debug prompt-input --help`, `codex features list`, `codex login status`; the runs of `<S>/cx/`; the documentation at learn.chatgpt.com (docs/hooks, docs/agent-configuration/agents-md, docs/config-file/config-reference, docs/config-file/config-advanced, docs/build-skills, docs/extend/mcp, docs/sandboxing, docs/agent-approvals-security, docs/agent-configuration/rules), read by the research agent and, for hooks, by this document's author.

- **Instructions.** Observed: `codex debug prompt-input -c 'developer_instructions="DEVINSTR-MARKER-9"' hello` puts the text as the first developer message; the `AGENTS.md` of the working folder follows as a user message. Checked (config reference): `developer_instructions` adds developer instructions; `model_instructions_file` replaces the built-in instructions (not wanted).
- **Verbs.** Observed: a skill in `<working folder>/.agents/skills/<name>/SKILL.md` is listed to the model; `-c 'skills.config=[{path=…,enabled=true}]'` did not add a skill from another folder. Checked (docs/build-skills): skills are found in `.agents/skills` from the working folder up to the repository root, in `$HOME/.agents/skills`, `/etc/codex/skills`, and the built-in set; `skills.config` only turns skills off. Checked (docs/custom-prompts): custom prompts live only in `~/.codex/prompts` and are deprecated. So a Codex session cannot be given the verbs as skills or commands without writing into the Space or the home folder. The design lists the verbs in the instructions, with each card's path (section 3.3).
- **Session server.** Observed: `codex mcp list -c 'mcp_servers.ailore.url="http://127.0.0.1:9/mcp/s-1"' -c 'mcp_servers.ailore.bearer_token_env_var="AILORE_TOKEN"' -c 'mcp_servers.ailore.tool_timeout_sec=300'` lists the server as `enabled` with `Bearer token` auth; `codex mcp get ailore --json -c …` shows the fields `http_headers`, `env_http_headers`, `bearer_token_env_var`, `startup_timeout_sec`, `tool_timeout_sec`. Checked (docs/extend/mcp): `tool_timeout_sec` defaults to 60 seconds. A connection to a real server was not made (the program is not signed in).
- **The hook.** Checked (docs/hooks): hooks are read from `hooks.json` or an inline `[hooks]` table next to each active configuration layer (`~/.codex/`, `<repo>/.codex/`). A `PreToolUse` entry is `{ matcher, hooks: [{ type: "command", command, timeout }] }`; it fires for shell commands (`Bash`), `apply_patch` (the file edits; `tool_input.command` holds the patch text, whose `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` lines name the paths) and MCP tools; it denies with `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":…}}` or exit code 2; any other exit code and a timeout let the call go on; the default timeout is 600 seconds. Hooks that are not managed must be trusted by the Human Lead in `/hooks`, recorded against the hook's hash; `--dangerously-bypass-hook-trust` runs enabled hooks without that trust for one run (Checked also in `codex --help`). Observed: `-c 'hooks.PreToolUse=[{matcher="^apply_patch$",hooks=[{type="command",command="/usr/bin/true",timeout=30}]}]'` is accepted and a wrong type is refused, so a `-c` value is read as the hooks table. Whether such a hook runs, and whether it needs the bypass flag, is Unverified (no signed-in run).
- **The sandbox and approvals.** Checked (`codex --help`, docs/sandboxing, docs/agent-approvals-security): `--sandbox read-only` lets commands read only; a command that needs to write asks the Human Lead (`--ask-for-approval on-request`); `--ask-for-approval` accepts only `on-request` and `never` in 0.155.0 (help text). Observed (`codex debug prompt-input`): in an untrusted folder the default is `read-only`, and the model is told how to ask for escalation. How a read-only sandbox treats `apply_patch` into the Workbench (asks, or refused) is Unverified.
- **The Human Lead's own configuration.** Observed: the interactive program has no `--ignore-user-config`; `~/.codex/config.toml` is read (its `nx-mcp` server was listed). Relocating `CODEX_HOME` would also move the sign-in (Checked, `codex exec --help`: "auth still uses `CODEX_HOME`" refers only to `--ignore-user-config`; docs/config-advanced says `CODEX_HOME` holds config, auth and history), so it is not used. A `-c` value given after the Human Lead's parameters wins over the same key given earlier (Checked: `-c` "overrides a configuration value"; the order of two `-c` for one key is Unverified).
- **Sign-in check.** Observed: `codex login status` printed `Not logged in` with exit code 0. The catalog's check (`exit-code`, args `login status`) therefore reads "signed in" on this machine. That is a defect of M9's catalog entry; phase M10.7 changes the check to read the text (section 5, M10.7).

**What a Codex session can be given, and what not.** Instructions and the session server: yes, per session, on the command line and in the environment. Verbs: only as a list inside the instructions; there are no `/` commands for them, and the Skills column types a sentence instead. File edits: a before-write hook on `apply_patch` given with `-c`, if M10.7 observes that it runs. Shell: the OS sandbox in `read-only` mode, so every write by a command asks the Human Lead; this is not a check by path. The Human Lead's own `config.toml`, `hooks.json` and rules files cannot be left out. The readiness report says "partly" for the Lore and for the guard.

### 2.5 OpenCode

Evidence: the documentation at opencode.ai/docs (config, rules, agents, permissions, mcp-servers, commands, skills, plugins, cli), read by the research agent in the rendered pages and the source of the pages in the repository `anomalyco/opencode`, and the source files `packages/core/src/flag/flag.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/src/tool/{edit,write,apply_patch}.ts`, `packages/opencode/src/plugin/shared.ts`. Nothing was run.

- **Configuration for one session.** Checked (docs/config): `OPENCODE_CONFIG` names a config file; `OPENCODE_CONFIG_DIR` names a folder searched for agents, commands, modes and plugins as `.opencode/` is; `OPENCODE_CONFIG_CONTENT` holds a whole config as JSON; `OPENCODE_PERMISSION` holds a permission object merged last over the resolved config (source `config.ts`). Precedence, later over earlier: remote organisation defaults, `~/.config/opencode/opencode.json`, `OPENCODE_CONFIG`, the project's `opencode.json`, `.opencode/` folders and `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`, managed files. There is no command-line option for a config file (docs/cli). The global config cannot be left out.
- **Instructions.** Checked (docs/rules): `AGENTS.md` walking up from the working folder, then `~/.config/opencode/AGENTS.md`, then `~/.claude/CLAUDE.md` as a fallback; `instructions` in the config adds files by path. `OPENCODE_DISABLE_CLAUDE_CODE=1` turns off every `.claude` fallback.
- **Verbs.** Checked (docs/commands): a file `commands/<name>.md` whose body is the prompt (with `$ARGUMENTS`) is a command `/<name>`; found in `.opencode/`, the global folder, and the folder of `OPENCODE_CONFIG_DIR`. Skills are found only in `.opencode/skills`, `.claude/skills`, `.agents/skills` and their global forms (docs/skills); whether `OPENCODE_CONFIG_DIR` adds skills is Unverified. The design uses commands.
- **Session server.** Checked (docs/mcp-servers): `"mcp": {"ailore": {"type": "remote", "url": "<url>", "headers": {…}, "enabled": true}}`; the tools are named `<server>_<tool>` (`ailore_await_answer`). `timeout` is the wait for the tool list (default 5 seconds); the wait for a tool call is Unverified.
- **The guard.** Checked (docs/plugins): a plugin file in `plugins/` of a configuration folder (including the folder of `OPENCODE_CONFIG_DIR`) exports an async function that returns hooks; `tool.execute.before(input, output)` receives `input.tool` and `output.args`, and throwing blocks the call. Checked (source): the file tools are `edit` (`filePath`, `oldString`, `newString`, `replaceAll`), `write` (`filePath`, `content`) and `apply_patch` (`patchText`, paths inside the patch). Plugins run in Bun (docs/plugins); whether a plugin may start `python3` with `node:child_process` `spawnSync` is Unverified. `--pure` runs "without external plugins" (docs/cli); whether that also drops a plugin in the `OPENCODE_CONFIG_DIR` folder is Unverified, so `--pure` is treated as guard-changing.
- **Permissions.** Checked (docs/permissions): `permission` keys `read`, `edit` (covers `edit`, `write`, `apply_patch`), `bash` (patterns over the parsed command; the last matching rule wins), `external_directory`, `webfetch`, and others; values `allow`, `ask`, `deny`; `--auto` approves every permission not explicitly denied. There is no sandbox.
- **The environment is set before the login shell.** The PTY starts an engine as `$SHELL -i -l -c '<command>'` (`main/pty.ts`), so a variable the Human Lead exports in `~/.zshrc` (for example `OPENCODE_CONFIG`) replaces the one the companion set. This is a limit for OpenCode and for Codex's token variable; the readiness report does not detect it.

**What an OpenCode session can be given, and what not.** Everything per session through environment variables and files in the session folder: instructions, verbs as commands, the session server, a guard plugin that checks each file tool by path, and shell permission rules equal to Claude Code's allow and deny lists. The Human Lead's global OpenCode configuration is merged in and cannot be left out. None of it was observed; OpenCode must be installed for phase M10.8's real-engine checks.

### 2.6 Can each engine be guarded, and how strongly

| Engine | File writes checked by path before they happen | Shell | After-write check reported to the session | User configuration left out | Verdict |
|---|---|---|---|---|---|
| Claude Code | Yes (observed) | Engine rules by command text; unknown commands ask | Yes | Yes | The reference |
| Antigravity CLI | Yes (observed, also with `--dangerously-skip-permissions`) | The adapter's rules by command text; unknown commands `force_ask` (with `--dangerously-skip-permissions` on, Unverified whether `force_ask` still asks; M10.6 check 7) | No | No | Close to Claude Code; "partly" |
| Codex CLI | Yes if M10.7 observes the `-c` hook running (documented) | OS sandbox read-only: every shell write asks | Unverified (documented form as Claude Code's) | No | Guarded differently; "partly" |
| OpenCode | Yes by plugin (documented, not observed) | Engine rules by pattern; unknown commands ask | Unverified | No | "partly" until observed |

---

## 3. Design

### 3.1 Where the new code lives

```
packages/core/src/engines/engines.ts            EngineParam, EngineEntry.params, parse and migration
packages/core/src/engines/params.ts             (new) splitParamText, defaultParamArgv, paramsFromArgs
packages/core/src/space/engines/catalog.ts      EngineCatalogEntry.seedParams
packages/core/src/space/engines/merge.ts        keeps params; seeds params for a catalog entry that has none
packages/core/src/space/desk/types.ts, guards.ts, lifecycle.ts   SessionRecord.unguarded
packages/core/src/space/project/dashboard-model.ts               BoardRow.local.unguarded

packages/app/src/main/space/sessions/engine-options.ts          (new, M10.3) reserved and guard-changing options per engine
packages/app/src/main/space/sessions/engines/                   (new, M10.5) the adapters
  types.ts          EngineAdapter, SessionLaunchInput, SessionLaunch, LoreCapability
  index.ts          adapterFor(engine)
  instructions.ts   sessionInstructions(input)
  skills.ts         readInstalledSkills(install)
  lore-readiness.ts loreReadiness(...)
  claude-code.ts    (M10.5)
  antigravity.ts    (M10.6)
  codex.ts          (M10.7)
  opencode.ts       (M10.8)
packages/app/src/main/space/sessions/adapters.ts   the Python adapters gain a --dialect argument (M10.5 to M10.8)
```

### 3.2 The engine adapter interface (main)

An adapter turns the pieces main already prepares for a session (the verified install, `python3`, the session server connection, the session folder) into what one engine needs: its argument list, its environment, and the files written into the session's folder. The session service keeps every other step of section 5.6 of `mvp-architecture.md` (record on the desk, register on the server, spawn in the PTY, end).

```ts
// packages/app/src/main/space/sessions/engines/types.ts
import type { EngineCatalogId } from '@ai-lore-companion/core';
import type { SessionConnection } from '../../session-server/index.js';
import type { SessionFilePaths } from '../files.js';
import type { VerifiedInstall } from '../preflight.js';
import type { InstalledSkill } from './skills.js';
import type { EngineOptions } from '../engine-options.js';

/** One aspect of the Lore readiness report (ruling 4). */
export type LoreAspect = 'lore' | 'session-tools' | 'guard';
/** `yes`: as a Claude Code session has it. `partly`: some of it, the text says what. `no`: none. */
export type LoreState = 'yes' | 'partly' | 'no';
export type LoreLine = { aspect: LoreAspect; state: LoreState; text: string };

/** What an adapter can give a session, before any live check. */
export type LoreCapability = { lore: LoreLine; sessionTools: LoreLine; guard: LoreLine };

/** Everything an adapter needs to launch one session. Every path is absolute. */
export type SessionLaunchInput = {
  sessionId: string;
  spaceRoot: string;
  deskDir: string;
  /** The session's folder and its fixed files (`files.ts`). */
  paths: SessionFilePaths;
  python: string;
  install: VerifiedInstall;
  skills: readonly InstalledSkill[];
  connection: SessionConnection;
  /** The names of the Space's repositories, from its manifest. */
  repositories: readonly string[];
  /** The session instructions of section 3.3, already rendered for this engine. */
  instructions: string;
  /** The argument list of the ticked parameters, in the order of the engine's parameters. */
  paramArgv: readonly string[];
};

/** A file an adapter writes, relative to the session's folder, with `/`. Mode 0600; folders 0700. */
export type LaunchFile = { path: string; content: string };

export type SessionLaunch = {
  /** The engine's arguments after its binary. The parameters come first. */
  args: string[];
  /** Added to the process environment, beside `AI_LORE_SESSION_ID`. */
  env: Record<string, string>;
  files: LaunchFile[];
};

export type EngineAdapter = {
  catalogId: EngineCatalogId;
  capability: LoreCapability;
  /** The engine's own reserved and guard-changing options (3.5). */
  options: EngineOptions;
  /** The text the Skills column types for a verb or process `name`, without a newline. */
  skillInvocation(name: string): string;
  /** `invoked`: the verbs are skills or commands the session can run. `listed`: the instructions list them with their card paths (3.3). */
  verbsAre: 'invoked' | 'listed';
  launch(input: SessionLaunchInput): SessionLaunch;
};
```

`adapterFor(engine: EngineEntry): EngineAdapter | null` returns the adapter of `catalogEntryFor(engine)?.catalogId`, or the Claude Code adapter when `isClaudeEngine(engine)` (a hand-added Claude Code), or `null`. A headless test asserts that every catalog entry with `guardedSessions: true` has an adapter.

Session files. The files every engine gets stay as today: `hooks/pre-write.py`, `hooks/post-write.py` and `refusals.jsonl` (written by the adapter at run time). `settings.json` and `mcp.json` become files of the Claude Code adapter. `writeSessionFiles(sessionsDir, input, launch)` writes the common files, then each `LaunchFile` (refusing a path that is absolute, holds `..` or a NUL), all with the modes of section 5.14.

The Python adapters. `PRE_WRITE_ADAPTER` and `POST_WRITE_ADAPTER` in `adapters.ts` gain an argument `--dialect claude|antigravity|codex|opencode` (default `claude`). The dialect decides only how the hook's input is read (which paths a call writes, whether it is a shell command) and how the decision is printed. Running the check scripts, the alarm, the refusal note and the scrub of the desk path stay shared. Section 5 fixes the Python functions per dialect.

### 3.3 The session instructions

Every engine gets the same short text, given in its own form: Claude Code `--append-system-prompt <text>` (answer 8); Antigravity the plugin's `rules/AGENTS.md`; Codex `-c developer_instructions=<text as a TOML string>`; OpenCode a file `AGENTS.md` in the session folder named in the config's `instructions`. This is a change for Claude Code, which gets no instruction today; the Human Lead accepted it (answer 8). The text, built by `sessionInstructions` in `engines/instructions.ts`:

```
This session was started by the AI-Lore companion in an AI-Lore 1.0 Space, whose folder is <spaceRoot>.
Read <spaceRoot>/ai_readme.md first and follow it. Then run the verb session-orient.
The session starts in Read only: it writes only to the Workbench (<spaceRoot>/workbench/) until the Human Lead confirms a claim.
The companion's tools for this session come from the MCP server "ailore": request_writing, request_gate, await_answer and leave_writing.
<verbs line>
```

The verbs line is `The verbs and processes of the Lore are invoked as <skillInvocation("<name>")>, for example <skillInvocation("session-orient")>.` for an adapter with `verbsAre: 'invoked'`. For `verbsAre: 'listed'` (Codex) it is `The verbs and processes of the Lore are these. To run one, read its card at the path given and follow it:` followed by one line per installed skill, `- <name>: <description> (<absolute card path>)`, in name order.

### 3.4 The parameter model

In the registry (`engines.json`, core `EngineEntry`):

```ts
/** One parameter of an engine, as the Human Lead typed it in Settings. */
export type EngineParam = {
  /** For example `--dangerously-skip-permissions` or `--model opus`. Split on white space into arguments. */
  text: string;
  /** Ticked on the start control when it opens. */
  defaultOn: boolean;
};

export type EngineEntry = {
  id: string;
  name: string;
  binary: string;
  /** The parameters, in order. Absent on an entry written by an older build. */
  params?: EngineParam[];
  /**
   * The arguments of the parameters ticked by default, in order, derived from
   * `params` on every parse and save. Kept for the v0.8 AI tab (`main/pty.ts`)
   * and for older builds that read `engines.json`.
   */
  args?: string[];
  helperModel?: string;
};
```

Rules:

1. `splitParamText(text)` splits on white space (`/\s+/`), drops empty strings. No quoting: a value with a space cannot be a parameter (the same limit as today's args field).
2. Migration, in `parseEngineEntry`: an entry without `params` and with a non-empty `args` gets `params: [{ text: args.join(' '), defaultOn: true }]`. An entry without `params` and without `args` keeps `params` absent. In every case `args` is then set to `defaultParamArgv(params)` (the arguments of the parameters with `defaultOn`), or removed when that is empty.
3. Catalog seed parameters. `EngineCatalogEntry` gains `seedParams: readonly EngineParam[]`. `mergeEnginesWithCatalog` gives a catalog entry `params: [...seedParams]` when the stored entry it merges has no `params` field (a new install, or an entry from before M10). An entry with `params: []` (the Human Lead removed them all) keeps `[]`. Seeds: Claude Code `[]`; Antigravity CLI `[{ text: '--dangerously-skip-permissions', defaultOn: true }]` (ruling 2's example and answer 6; it is not guard-changing for Antigravity, so a session started with it is guarded); Codex CLI `[]`; OpenCode `[]`.
4. Identity for `dedupEngines`: `params` replaces `args` in the identity tuple (texts and flags joined).
5. The ticked parameters travel to main by their `text`. Main starts the session only with texts that are parameters of that engine now; any other text is refused. The renderer can no longer put an arbitrary option on an engine's command line.

What is removed (M10.3): the store fields `executionFlags` and `setExecutionFlags` of `spaceNavStore.ts`; the props `flags` and `onFlagsChange` of `EngineStartControl` with its "Settings" panel, text input and the four style objects `flagsWrapperStyle`, `flagsToggleStyle`, `flagsPanelStyle`, `flagLabelStyle`; `flags` on `SpaceSessionEngineArg` and in `engineSchema` of `main/space/ipc/sessions.ts`; the `flags` argument of `SpaceSessions.start` and `EngineArgvParts.flags`; `GUARD_CHANGING_ENGINE_OPTIONS` and `guardChangingEngineOption` of `command-line.ts` (moved to `engine-options.ts`); the "Args" text input of the Settings editor.

### 3.5 Options per engine, and the unguarded label

Each engine declares its own two lists (answer 6); the same option can be guard-changing for one engine and not for another (`--dangerously-skip-permissions` is guard-changing for Claude Code and not for Antigravity). M10.3 writes the four lists as constants in `engine-options.ts` (`CLAUDE_CODE_OPTIONS`, `ANTIGRAVITY_OPTIONS`, `CODEX_OPTIONS`, `OPENCODE_OPTIONS`), because the adapters do not exist yet; M10.5 adds `options: EngineOptions` to `EngineAdapter`, each adapter sets it to its engine's constant, and the lookup `optionsFor(engine)` returns `adapterFor(engine)?.options ?? null`. The two lists:

- `reserved`: options the companion sets itself. A ticked parameter holding one is refused at start with `engine-not-supported` and the `edit-engine` fix. The parameter is shown disabled on the start control.
- `guardChanging`: options that change what the session may do without the Human Lead, or where its settings come from. A session with one starts, and is unguarded.

An argument matches an option when it equals it or starts with `<option>=`. For Codex, `-c` and `--config` are guard-changing unless the key of their value is `model` or `model_reasoning_effort` (the value is the next argument, or the text after `=`). The lists are in M10.3's specification.

Unguarded, where it shows:

- `SessionRecord.unguarded?: string[]` (core): the guard-changing options of the session, by name (`--dangerously-skip-permissions`, not `--permission-mode=…`), recorded by `startSession` when non-empty.
- `SpaceSessionHeader.unguarded: string[]` and `SpaceSessionStarted.unguarded: string[]`.
- The session header: a pill `Unguarded` (`data-testid="session-header-unguarded"`, title `Started with <options>: the companion's guard does not hold for this session.`).
- The tab title: `WorkspaceTab.unguarded?: boolean`; the automatic titles of an AI tab end with ` · unguarded`.
- The Agents board row: `BoardRow.local.unguarded: boolean`; the row shows `Unguarded: started with <options>.` from the local record (`data-testid="agents-row-unguarded-<issue number>"`). A session appears on the Agents board only once it has an issue (after its first Writing); a Read only session has no Dashboard row today, and M10 adds none.

### 3.6 The Lore readiness report

For each option of the engine choice, main adds `lore: SpaceEngineLore`:

```ts
export type SpaceLoreLine = { aspect: 'lore' | 'session-tools' | 'guard'; state: 'yes' | 'partly' | 'no'; text: string };
export type SpaceEngineLore = {
  lines: SpaceLoreLine[];          // always three, in the order lore, session-tools, guard
  asClaudeCode: boolean;           // all three are 'yes'
};
```

It is computed by `loreReadiness(adapter, readiness)` in `engines/lore-readiness.ts`:

1. No adapter: the three `no` lines `The companion cannot give this engine the Lore yet.`, `It would not have the session tools.`, `Its writes would not be guarded.`
2. Otherwise start from `adapter.capability`, then apply the live checks of the readiness that already run (A.10): a failure of kind `not-installed`, `install-record-unreadable`, `install-record-newer` or `plugin-missing` sets `lore` to `no` with `The Lore is not installed for this Space.`; `check-missing` or `check-altered` sets `guard` to `no` with `The write-guard's check scripts are not installed as the install recorded them.`; `python3-missing` sets `guard` to `no` with `python3 3.8 or later was not found; the write-guard runs with it.` A failure of kind `engine-not-installed`, `engine-not-signed-in` or `engine-not-found` changes no line (the option's reason says it).
3. Readiness gets one new live check for an adapter that reads installed skills: when the install lists no skill, `lore` becomes `partly` with `The install holds no verb; install the Lore again.`

The ticked parameters are the renderer's state, so the renderer applies one more rule when it shows the report: when a ticked parameter's effect is `unguarded`, the guard line reads `no` and `Unguarded: <options> changes the guard.`

Static capability texts (copy; the states are proposals that each engine's phase confirms or changes from its observations):

| Engine | lore | session-tools | guard |
|---|---|---|---|
| Claude Code | yes — `Reads the Lore's instructions, and its verbs as skills (/lore:<name>).` | yes — `Has the companion's session tools.` | yes — `File edits are checked by the write-guard; shell commands follow the session's permission rules.` |
| Antigravity CLI | yes — `Reads the Lore's instructions as a rule, and its verbs as skills.` | yes — `Has the companion's session tools.` | partly — `File edits are checked by the write-guard; shell commands are checked by their text, your own Antigravity permissions still apply, and a failed Lore check after a write is not reported to the session.` |
| Codex CLI | partly — `Reads the Lore's instructions; the verbs are listed in them and are not commands.` | yes — `Has the companion's session tools.` | partly — `File edits are checked by the write-guard; shell commands run in Codex's read-only sandbox and ask you before they write; your own Codex configuration still applies.` |
| OpenCode | yes — `Reads the Lore's instructions, and its verbs as commands (/<name>).` | yes — `Has the companion's session tools.` | partly — `File edits are checked by the write-guard through a plugin; shell commands follow the session's permission rules, merged with your own OpenCode configuration.` |

On the start control, under the note, for the chosen engine: a line `Reads the Lore as Claude Code does: yes` (or `partly`, `no`; `partly` when any line is not `yes` and not all are `no`), `data-testid="<buttonTestId>-lore"`, `data-state`, then the three lines, each `<Word> — <text>` with the word `Yes`, `Partly` or `No` written out (not colour alone), `data-testid="<buttonTestId>-lore-<aspect>"` and `data-state`. In the engine menu each startable option adds ` — reads the Lore as Claude Code does` when `asClaudeCode`, else ` — reads the Lore partly`.

### 3.7 IPC changes

All in `packages/app/src/shared/ipc/space/sessions.types.ts` and `sessions.contract.ts`, handlers in `main/space/ipc/sessions.ts`.

| Change | Phase |
|---|---|
| `SpaceSessionEngineArg` becomes `{ engineId: string }` (readiness). New `SpaceSessionStartArg = { engineId: string; params: string[] }` for `spaceSessionStart`; zod `z.strictObject({ engineId: z.string().min(1).max(256), params: z.array(z.string().min(1).max(1024)).max(32) })` | M10.3 |
| `SpaceEngineParam = { text: string; defaultOn: boolean; effect: 'none' | 'unguarded' | 'refused'; options: string[] }` (`options`: the reserved or guard-changing option names it holds); `SpaceEngineOption.params: SpaceEngineParam[]` | M10.3 |
| `SpaceSessionStarted.unguarded: string[]`; `SpaceSessionHeader.unguarded: string[]` | M10.3 |
| `SpaceEngineOption.lore: SpaceEngineLore` and the two types of 3.6 | M10.5 |
| `SpaceSkillsArg` becomes `{ engineId?: string }`; `SpaceSkill.invocation: string` (the text the column types; `/lore:<name>` when no engine or no adapter) | M10.5 |
| `SpaceEngineFix` for `sign-in` names the engine's own sign-in command (`engine-sign-in:<catalogId>`) and label `Sign in to <name>` | M10.5 |

---

## 4. Decisions, and the Human Lead's answers

Decisions this document makes. Each is reversible.

1. **Parameters travel by their text, and main checks them** against the engine's parameters. The earlier field sent any text to the command line.
2. **`args` stays in `engines.json`, derived** from the default parameters, so the v0.8 AI tab and older builds keep working.
3. **Every engine, Claude Code included, gets the session instructions of 3.3.** It is what makes "the Lore's instructions" true for all four; for Claude Code it adds `--append-system-prompt` (confirmed by answer 8).
4. **Two kinds of option, per engine.** Options the companion sets (for example `--settings` for Claude Code, and `--bare` and `--safe-mode`, which turn the plugin and hooks off) are refused, because a session with them has no Lore or no connection to the companion. Options that change the guard are allowed and label the session (ruling 3).
5. **No per-engine files in the Space and none in the Human Lead's home folder.** Antigravity gets its plugin through a second `--add-dir`; Codex gets everything on the command line and in the environment; OpenCode through environment variables naming files in the session folder. The cost: Codex has no `/` commands for the verbs (they are listed in the instructions).
6. **Codex runs with `--sandbox read-only --ask-for-approval on-request`.** Every shell write asks. A `--sandbox workspace-write` parameter is guard-changing and labels the session.
7. **Catalog flags are switched in M10.9**, after the real-engine checks of each engine's phase pass, so that three parallel phases do not edit `catalog.ts`. An engine whose checks could not be run when the tester ran them (Codex still signed out; OpenCode still not installed) keeps `guardedSessions: false`, and the phase report says so (ruling 5).
8. **The Codex sign-in check reads the text** of `codex login status` (`Logged in` at the start of a line means signed in; `Not logged in` means not), because its exit code is 0 in both cases.

The Human Lead's answers (2026-09-19) to this document's questions:

1. **Antigravity's seed parameter.** Seeded and ticked by default, and not guard-changing for Antigravity (answer 6 of section 1). M10.9 re-confirms it with a real run and specifies the fallback.
2. **Codex's shell.** `--sandbox read-only` (answer 7). A `--sandbox` parameter is guard-changing and labels the session.
3. **Claude Code's instructions.** Given with `--append-system-prompt`, in M10.5 (answer 8).
4. **Real engines.** The Human Lead signs in to Codex and installs OpenCode, so M10.7 and M10.8 run their real-engine checks; a check that cannot run is skipped with a report line (answer 9).

No question is open.

---

## 5. Phases

### How to read a phase

As in `onboarding-architecture.md` Part C. Each phase lists its files and the exact changes. "Create" is a new file; "Edit" an existing one. Names, types, copy and test ids given here are fixed; what a phase does not fix is the developer's smallest choice under section 7 of `mvp-architecture.md`, listed under "Choices made" in the phase report.

Every phase ends with the definition of done of section 8.7 of `mvp-architecture.md`. The commands, from the repository root, with `<id>` the phase id in lower case (`m10-3`):

```
npm run verify
npm run lint
AI_LORE_CORE_TEST_OUT=.test-runs/<id>/dist-test npm test -w @ai-lore-companion/core
AI_LORE_APP_TEST_OUT=.test-runs/<id>/dist-test npm run test:headless -w @ai-lore-companion/app
npm run test:component -w @ai-lore-companion/app
npm run e2e                      # phases that change main, preload or renderer
```

The baseline is the end of M10.2: `npm run verify` green (core 1054, app headless 450 with one skip, component 343), `npm run e2e` 60 passed and 2 skipped. The working tree at the start of M10 holds uncommitted changes of the repair session (the files listed by `git status`); a phase builds on them and does not revert them.

An existing test whose behaviour a ruling changes is edited, not deleted, and the report names it. Developer agents run with the project root as their working directory, write files only with the Write and Edit tools, and make no commit. Real-engine runs (M10.6 to M10.9) are made only in a scratch folder under the session's scratchpad, never in this repository or a real Space, with standard input closed, as in M4.1.

### Order and parallel groups

| Group | Phases | Runs after |
|---|---|---|
| 1 | M10.3 | — |
| 2 | M10.5 | M10.3 |
| 3 | M10.6, M10.7 and M10.8 in parallel | M10.5 |
| 4 | M10.9 | M10.6, M10.7, M10.8 |

Files shared across phases, and their owner. A phase that needs a line in a file it does not own reports the line; the next phase that is not parallel with the owner adds it.

| File | Owner |
|---|---|
| `packages/core/src/space/engines/catalog.ts` | M10.3 (seed params), M10.7 (Codex sign-in check), M10.9 (`guardedSessions`) |
| `packages/app/src/main/space/sessions/engine-options.ts` | M10.3; M10.5 (the body of `optionsFor`); M10.9 (the Antigravity fallback only) |
| `packages/core/src/space/machine/engine-sign-in.ts`, `machine/index.ts` | M10.7 |
| `packages/app/src/main/space/sessions/engines/index.ts` | M10.5 creates it with all four imports; M10.6, M10.7, M10.8 only fill their own adapter file, which M10.5 creates as a stub |
| `packages/app/src/main/space/sessions/adapters.ts` | M10.5 (the dialect switch and the `claude` dialect, and stubs for the three others); M10.6, M10.7, M10.8 each replace only the body of their own two Python functions, marked by the comment lines `# dialect: <name>` |
| `packages/app/src/shared/ipc/space/sessions.types.ts`, `sessions.contract.ts` | M10.3, then M10.5 |
| `packages/app/test/space-window.spec.ts`, `space-dashboard.spec.ts` | M10.9 |

---

### M10.3 — Engine parameters with defaults, and the unguarded label

**Goal.** Each engine has parameters with a default tick, edited in Settings; the start control shows the chosen engine's parameters as checkboxes; the ticked ones reach the engine after main checks them; a guard-changing parameter starts an unguarded session labelled in its header, tab and Agents board row; the free-text flags field is gone.

**Depends on.** Nothing in M10. Parallel with nothing.

**Files and changes.**

1. Create `packages/core/src/engines/params.ts`:

   ```ts
   import type { EngineParam } from './engines.js';
   /** The arguments of one parameter: its text split on white space, empty parts dropped. */
   export function splitParamText(text: string): string[];
   /** The arguments of the parameters with `defaultOn`, in order. */
   export function defaultParamArgv(params: readonly EngineParam[]): string[];
   /** The migration of rule 2 of 3.4: one parameter ticked by default holding every argument, or `[]` for none. */
   export function paramsFromArgs(args: readonly string[]): EngineParam[];
   ```
   Export them from `packages/core/src/engines/index.ts`.

2. Edit `packages/core/src/engines/engines.ts`: add `EngineParam` and `params?: EngineParam[]` as in 3.4, with the doc comments given there. `isEngineEntry` accepts `params` when it is an array of objects with a string `text` (1 to 1024 characters after trimming) and a boolean `defaultOn`. `parseEngineEntry` keeps `params` (texts trimmed, entries with an empty text dropped), applies the migration of rule 2, and sets `args` to `defaultParamArgv(params)` when `params` is present (removing `args` when that is empty). `engineCatalog.identity` becomes `` `${e.id}|${e.name.toLowerCase()}|${e.binary}|${(e.params ?? []).map((p) => `${p.defaultOn ? '+' : '-'}${p.text}`).join('\u0001')}|${e.helperModel ?? ''}` ``.

3. Edit `packages/core/src/space/engines/catalog.ts`: `EngineCatalogEntry` gains `seedParams: readonly EngineParam[]` (doc: `The parameters a catalog entry gets when the stored entry has none (3.4 rule 3).`); seeds as rule 3 of 3.4.

4. Edit `packages/core/src/space/engines/merge.ts`: `mergedEntry` keeps `taken.params` when it is defined; when `taken` is null or `taken.params` is undefined, sets `params: [...slot.entry.seedParams]` when the seed is non-empty. Then sets `args` from `defaultParamArgv(params)` as `parseEngineEntry` does (removed when empty). Rule 3 of the file's doc comment gains this.

5. Edit `packages/core/src/space/desk/types.ts`: `SessionRecord.unguarded?: string[]` (doc: `The options that changed the guard when the session started. Absent when none.`). `guards.ts`: `isSessionRecord` accepts it when absent or an array of non-empty strings. `lifecycle.ts`: `SessionStart.unguarded?: string[]`; `startSession` writes it only when non-empty.

6. Edit `packages/core/src/space/project/dashboard-model.ts`: `BoardRow.local` gains `unguarded: string[]` (from the record, `[]` when absent).

7. Create `packages/app/src/main/space/sessions/engine-options.ts`. Each engine has its own lists (answer 6 of section 1); there is no list shared by all engines.

   ```ts
   /** The options of one engine: set by the companion (a parameter holding one is refused), and changing the guard (the session is unguarded). */
   export type EngineOptions = { reserved: readonly string[]; guardChanging: readonly string[] };
   export const CLAUDE_CODE_OPTIONS: EngineOptions;
   export const ANTIGRAVITY_OPTIONS: EngineOptions;
   export const CODEX_OPTIONS: EngineOptions;
   export const OPENCODE_OPTIONS: EngineOptions;
   /**
    * The options of `engine`: by its catalog id, or CLAUDE_CODE_OPTIONS for a
    * hand-added Claude Code (`isClaudeEngine`); null for any other engine.
    * M10.5 replaces the body with `adapterFor(engine)?.options ?? null`.
    */
   export function optionsFor(engine: EngineEntry): EngineOptions | null;
   export type ParamEffect = { effect: 'none' | 'unguarded' | 'refused'; options: string[] };
   /** What the argument list of one parameter does under `options`. `options` of the result are option names without `=value`. */
   export function paramEffect(options: EngineOptions | null, argv: readonly string[]): ParamEffect;
   ```
   The lists:
   - `CLAUDE_CODE_OPTIONS`: reserved `--settings`, `--setting-sources`, `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, `--allowedTools`, `--allowed-tools`, `--append-system-prompt`, `--bare`, `--safe-mode`; guardChanging `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode`, `--permission-prompt-tool`, `--tools`, `--add-dir`.
   - `ANTIGRAVITY_OPTIONS`: reserved `--print`, `-p`, `--prompt`, `--output-format`, `--input-format`; guardChanging `--mode`, `--add-dir`. `--dangerously-skip-permissions` is in neither list (answer 6); a code comment above the constant says: `--dangerously-skip-permissions is not guard-changing for Antigravity: the Lore's PreToolUse hook was observed to refuse writes with it on (m10-architecture.md 2.3). M10.9 re-confirms it.`
   - `CODEX_OPTIONS`: reserved `--dangerously-bypass-hook-trust`, `exec`, `e`; guardChanging `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, `-s`, `--sandbox`, `-a`, `--ask-for-approval`, `--add-dir`, `-p`, `--profile`, `--enable`, `--disable`, `--approve-for-me`, `-C`, `--cd`, `--remote`, `--remote-auth-token-env`. `-c` and `--config` are handled by `paramEffect` under the key rule of 3.5 for `CODEX_OPTIONS` only (the function compares `options === CODEX_OPTIONS`).
   - `OPENCODE_OPTIONS`: reserved `run`, `serve`, `web`; guardChanging `--auto`, `--agent`, `--pure`.
   A match is an argument equal to the option, or starting with `<option>=`. `refused` wins over `unguarded`. For `options` null, the effect is `none`.

8. Edit `packages/app/src/main/space/sessions/command-line.ts`: remove `GUARD_CHANGING_ENGINE_OPTIONS`, `guardChangingEngineOption` and `EngineArgvParts.flags`; `EngineArgvParts.engineArgs` is documented as `The arguments of the ticked parameters, which come first.`

9. Edit `packages/app/src/main/space/sessions/preflight.ts`: `checkSessionEngine` no longer looks at `engine.args` (the parameters are checked at start). Add:

   ```ts
   /** The ticked parameters of a start: every text must be a parameter of `engine`. */
   export function checkStartParams(
     engine: EngineEntry,
     texts: readonly string[],
   ): Checked<{ argv: string[]; unguarded: string[] }>;
   ```
   It uses `paramEffect(optionsFor(engine), splitParamText(text))` for each text. Refusals: a text not among `engine.params` texts: `invalid-argument`, `No AI session was started: the parameter "<text>" is not one of the parameters of <name>.`; a parameter whose effect is `refused`: `engine-not-supported`, `No AI session was started: the parameter <option> of <name> is set by the companion for every session. Untick it, or remove it in Settings.` `argv` is the texts' arguments in the order of `engine.params`; `unguarded` is the union of the guard-changing option names, in first-seen order.

10. Edit `packages/app/src/main/space/sessions/service.ts`: `start(engineId: string, params: readonly string[])`; after readiness, `checkStartParams`; a refusal is returned as today's refusals are (logged `session-not-started`). `startSession` gets `unguarded`. `engineArgv` gets `engineArgs: checked.argv`. `StartedSession` gains `unguarded: string[]`. Log `session-started` gains `unguarded` (the option names only).

11. Edit `packages/app/src/main/space/sessions/engine-choice.ts`: each option gains `params: SpaceEngineParam[]` built from `engine.params ?? []` with `paramEffect(optionsFor(engine), splitParamText(p.text))`. `reasonFor('engine-not-supported')` stays.

12. Edit `packages/app/src/main/space/sessions/header.ts`: `readSessionHeader` fills `unguarded` from the record (`[]` when absent).

13. Edit `packages/app/src/shared/ipc/space/sessions.types.ts` and `sessions.contract.ts`: the M10.3 rows of 3.7. `spaceSessionStart` takes `SpaceSessionStartArg`. `packages/app/src/main/space/ipc/sessions.ts`: `startSchema` as in 3.7; `engineSchema` becomes `{ engineId }` only; the start handler passes `parsed.value.params`.

14. Edit `packages/app/src/renderer/src/space/window/spaceNavStore.ts`: remove `executionFlags` and `setExecutionFlags`. Add:

    ```ts
    /** The ticked parameter texts per engine id, for this window. Absent: the engine's defaults. */
    tickedParams: Record<string, string[]>;
    setTickedParams: (engineId: string, texts: string[]) => void;
    ```
    `startAiSession(engineId)` is unchanged; the Sessions screen reads the ticked texts from the store when it starts.

15. Edit `packages/app/src/renderer/src/space/window/EngineStartControl.tsx`: remove the flags props, panel and four styles (3.4). Add props `ticked: string[] | null` (null: the defaults) and `onTickedChange: (engineId: string, texts: string[]) => void`. For the chosen option (`choice.engineId`), under the split button:
    - Heading `Parameters of <name>` (`<buttonTestId>-params`).
    - When it has none: `<name> has no parameters. Add them in Settings, Engines.` and a link-style button `Edit parameters` (`<buttonTestId>-params-edit`) → `useSpaceSettings.getState().open('engines')`.
    - One checkbox per parameter (`<buttonTestId>-param-<index>`, label the text in monospace); checked when its text is in `ticked ?? defaults`. `effect: 'unguarded'` adds the muted words ` — changes the guard`; `effect: 'refused'` disables the box, unticks it, and adds ` — set by the companion; remove it in Settings`.
    - When a ticked parameter has `effect: 'unguarded'`: the line (`<buttonTestId>-unguarded-note`) `This session will be unguarded: <options, joined by ", "> changes what it may do without asking you. Its tab and its Dashboard entry will say so.`, and the button reads `Start an unguarded <name> session`.
    - `onStart(engineId)` is unchanged; the parent sends the ticked texts.

16. Edit `packages/app/src/renderer/src/space/dashboard/StartSession.tsx` and `packages/app/src/renderer/src/space/window/SpaceSessions.tsx`: pass `ticked={tickedParams[engineId] ?? null}` and `onTickedChange={setTickedParams}`; `SpaceSessions`' `spaceAi.start` sends `{ engineId, params: tickedParams[engineId] ?? defaultTexts(option) }` where `defaultTexts(option)` is the texts with `defaultOn` and `effect !== 'refused'`. On a start with `unguarded.length > 0`, `setTabs((prev) => withAiUnguarded(prev, tab.id))`.

17. Edit `packages/app/src/renderer/src/components/TabbedPanel.tsx`: `WorkspaceTab.unguarded?: boolean` (doc: `For an AI tab of a Space: its session started unguarded (M10.3).`). Edit `packages/app/src/renderer/src/space/window/sessionTabs.ts`: `export const UNGUARDED_TITLE_SUFFIX = ' · unguarded';` `withAiUnguarded(tabs, tabId)` sets `unguarded: true` and appends the suffix to `baseTitle` and, unless `manualTitle`, to `title`; `withAiEngine`, `withAiRunning` and `withTerminalStatus` append the suffix to the automatic title they build when `tab.unguarded`.

18. Edit `packages/app/src/renderer/src/space/session-header/SessionHeader.tsx`: when `header.unguarded.length > 0`, the pill `Unguarded` of 3.5 after the mode pill.

19. Edit `packages/app/src/renderer/src/space/dashboard/AgentsBoard.tsx`: when `row.local !== null && row.local.unguarded.length > 0`, the line of 3.5.

20. Edit `packages/app/src/renderer/src/components/SettingsSheet.tsx` (`EnginesSection`): the draft keeps `helperModel` and `params` (today's `commitDraft` drops `helperModel`). The "Args" input is replaced by a parameter list: one row per parameter with a text input (`engine-draft-param-<index>`), a checkbox `Ticked by default` (`engine-draft-param-default-<index>`) and `Remove` (`engine-draft-param-remove-<index>`); under the list `Add parameter` (`engine-draft-param-add`). A parameter whose text is empty after trimming is dropped on save. `engineMetaSummary` shows the binary and then each parameter's text, the ticked-by-default ones followed by ` (default)`. The catalog note becomes `Listed by AI-Lore; it cannot be removed. Its parameters can be edited.`

**Tests to add or change.**

- Core `packages/core/test/engines.test.ts` (extend): `splitParamText('  --model   opus ')` is `['--model','opus']`; an entry with `args: ['--model','opus']` and no `params` parses to one parameter `--model opus` ticked and `args` unchanged; an entry with `params` of two, one ticked, gets `args` of the ticked one; an entry with `params: []` keeps `[]` and has no `args`; a parameter with an empty text is dropped; identity differs when only a default tick differs.
- Core `packages/core/test/space/engines.test.ts` (extend): a stored list without Antigravity gets its seed parameter ticked; a stored Antigravity with `params: []` keeps `[]`; a stored Claude Code with `args` keeps its migrated parameter.
- Core desk tests (the file that tests `isSessionRecord` and `startSession`; extend): a record with `unguarded: ['--x']` passes; with `unguarded: [1]` fails; `startSession` with `unguarded: []` writes no field.
- Core dashboard model test (extend): `local.unguarded` comes from the record.
- App headless `engine-options.test.ts` (new): for each of the four constants, each reserved option gives `refused` and each guard-changing option `unguarded`, as itself and in the `=value` form; `['--model','opus']` gives `none` for every constant; `['--dangerously-skip-permissions']` gives `unguarded` under `CLAUDE_CODE_OPTIONS` and `none` under `ANTIGRAVITY_OPTIONS`; `ANTIGRAVITY_OPTIONS.guardChanging` does not contain `--dangerously-skip-permissions`; Codex `-c model="o3"` gives `none` and `-c sandbox_mode="danger-full-access"` and `--config=hooks.x=1` give `unguarded`; `-c sandbox_mode="x"` under `CLAUDE_CODE_OPTIONS` gives `none`; `optionsFor` gives `ANTIGRAVITY_OPTIONS` for `default.antigravity`, `CLAUDE_CODE_OPTIONS` for a hand-added `claude` binary, null for a hand-added `gemini`; `paramEffect(null, …)` gives `none`.
- App headless `sessions.test.ts`: the test "an engine entry with an option that changes the guard is not started" is changed to test `checkStartParams`: `--model opus` passes with no unguarded; `--dangerously-skip-permissions` passes with `unguarded: ['--dangerously-skip-permissions']`; `--permission-mode=bypassPermissions` gives `['--permission-mode']`; `--settings /tmp/x.json` and `--bare` are refused `engine-not-supported`; a text that is not a parameter is refused `invalid-argument`. Extend "the IPC starts a guarded session…": a start with a guard-changing parameter records `unguarded` on the desk, answers it in `SpaceSessionStarted`, and the header answers it; a start with `params` holding an unknown text is refused.
- App headless `engine-choice.test.ts` (extend): options carry `params` with their effects.
- Component `engine-start-control.test.tsx` (extend): the chosen engine's parameters are listed with defaults ticked; an Antigravity option whose parameter `--dangerously-skip-permissions` has `effect: 'none'` shows it ticked, shows no unguarded note, and the button reads `Start a Antigravity CLI session` (today's `Start a <name> session` form); ticking a guard-changing one shows the unguarded note and `Start an unguarded Claude Code session`; a refused parameter is disabled; no parameters shows `Edit parameters`.
- Component `space-ai-session.test.tsx` (extend): a start sends `params` with the ticked texts; an unguarded start gives the tab title the suffix `· unguarded` and the header pill `Unguarded`.
- Component `dashboard-agents.test.tsx` (extend): a row whose local session is unguarded shows `Unguarded: started with --dangerously-skip-permissions.`
- Component `settings-sheet-spaces.test.tsx` (extend; the catalog note text changes): editing an engine adds a parameter, ticks it by default and saves `params` through `enginesSave`; `helperModel` survives an edit.

**Verify.** All commands, `npm run e2e` included.

**Manual check left for the Human Lead.** In Settings, Antigravity lists `--dangerously-skip-permissions` ticked by default; the start control of a Space shows it ticked without the words `changes the guard` and without the unguarded note. For Claude Code, adding and ticking `--dangerously-skip-permissions` shows the unguarded note. (Antigravity cannot start until M10.9 turns its flag on.)

**Out of scope.** Adapters; the readiness report.

---

### M10.5 — The adapter interface, Claude Code behind it, the session instructions, and the Lore readiness report

**Goal.** Session launch goes through `EngineAdapter`; Claude Code's launch is unchanged except for the session instructions; the start control shows the Lore readiness of each engine; the Skills column types each engine's invocation; the sign-in fix names the engine.

**Depends on.** M10.3.

**Files and changes.**

1. Create `packages/app/src/main/space/sessions/engines/types.ts` as in 3.2.

2. Create `packages/app/src/main/space/sessions/engines/skills.ts`:

   ```ts
   export type InstalledSkill = {
     name: string;            // the skill's folder name
     description: string;     // from the SKILL.md frontmatter
     cardPath: string;        // absolute path of the card in the Space
     skillFile: string;       // absolute path of the SKILL.md in the install
     text: string;            // the SKILL.md as written
   };
   /** The skills of the install, sorted by name. Reads install.json and each skill file. */
   export async function readInstalledSkills(installDir: string, spaceRoot: string): Promise<InstalledSkill[]>;
   ```
   It reads the install record (`readInstallRecord`), takes files of kind `skill`, reads each with `readFile`, parses the frontmatter with `parseLoreFrontmatter` (as `header.ts` does), takes the card path from the file's first card (`join(spaceRoot, card.path)`). A skill file that cannot be read or has no description is left out. Move the frontmatter reading that `header.ts` does for `spaceSkillsList` to use this function.

3. Create `packages/app/src/main/space/sessions/engines/instructions.ts` with `sessionInstructions(input: { spaceRoot: string; skills: readonly InstalledSkill[]; adapter: Pick<EngineAdapter, 'skillInvocation' | 'verbsAre'> }): string`, the text of 3.3 exactly, lines joined with `\n`, ending with `\n`.

4. Create `packages/app/src/main/space/sessions/engines/claude-code.ts`: `export const claudeCodeAdapter: EngineAdapter`. `capability` from the table of 3.6. `options: CLAUDE_CODE_OPTIONS`. `skillInvocation: (name) => \`/lore:${name}\``; `verbsAre: 'invoked'`. `launch`: files `settings.json` (from `buildSessionSettings`) and `mcp.json` (from `buildSessionMcpConfig`); args `engineArgv({ engineArgs: paramArgv, settingsFile, mcpFile, pluginDir: install.pluginDir, tools, appendSystemPrompt: instructions })`; env `{}`. `command-line.ts`: `EngineArgvParts.appendSystemPrompt: string`, placed as `'--append-system-prompt', text` before `--allowedTools` (the Human Lead's answer 8).

5. Create `packages/app/src/main/space/sessions/engines/antigravity.ts`, `codex.ts`, `opencode.ts`: each exports its adapter with the `capability` of 3.6, `options` (`ANTIGRAVITY_OPTIONS`, `CODEX_OPTIONS`, `OPENCODE_OPTIONS`), `skillInvocation` (Antigravity `/<name>`, Codex `Run the Lore's <name>: read its card and follow it.`, OpenCode `/<name>`), `verbsAre` (Codex `'listed'`, the others `'invoked'`), and a `launch` that throws `new Error('the <name> adapter is not built yet')`. M10.6 to M10.8 fill them.

6. Create `packages/app/src/main/space/sessions/engines/index.ts`: `adapterFor(engine: EngineEntry): EngineAdapter | null` as in 3.2. Edit `engine-options.ts`: the body of `optionsFor` becomes `return adapterFor(engine)?.options ?? null;` (the doc comment's last sentence is removed). The four constants stay in `engine-options.ts`, so an adapter file imports its constant from there and `engine-options.ts` imports `adapterFor` from `engines/index.js`; if the build reports an import cycle, `optionsFor` moves to `engines/index.ts` and its callers import it from there.

7. Create `packages/app/src/main/space/sessions/engines/lore-readiness.ts`: `loreReadiness(adapter: EngineAdapter | null, readiness: SessionReadiness, skillCount: number | null): SpaceEngineLore` with the rules and copy of 3.6. `skillCount` null means not read.

8. Edit `packages/app/src/main/space/sessions/files.ts`: `SessionFilesInput` loses the Claude-only fields that move to the adapter; `writeSessionFiles(sessionsDir, input: { sessionId: string }, launch: SessionLaunch)` writes the two Python adapters and each `LaunchFile` (creating parent folders 0700; refusing a path that is absolute, holds `..` as a segment, or a NUL, with `Error('an adapter named a file outside the session folder: <path>')`). `buildSessionSettings` and `buildSessionMcpConfig` stay here and are used by the Claude Code adapter.

9. Edit `packages/app/src/main/space/sessions/adapters.ts`: both Python adapters take `--dialect` (one of `claude`, `antigravity`, `codex`, `opencode`; default `claude`; any other value is a fault). Split the dialect-dependent parts into these Python functions, each dispatching on the dialect, with one `# dialect: <name>` block per dialect:
   - `written_paths(data, dialect) -> list[str]`: the absolute paths the call writes; `[]` for a call that writes no file; raises `Fault` when a file tool's input names no path. `claude`: today's `written_path`, as a list.
   - `shell_command(data, dialect) -> tuple[str, str] | None`: `(command, cwd)` for a shell call of a dialect whose adapter judges the shell (Antigravity), else `None`.
   - `emit_pre(decision, reason, dialect)`: `claude` prints today's JSON.
   - `emit_post(problem_text_or_none, dialect)`: `claude` prints today's form.
   The three other dialects raise `Fault('the <dialect> dialect is not built yet')` in M10.5. `hookArgv` in `command-line.ts` gains `dialect` (`--dialect <value>` after `--adapter-seconds`); the Claude Code adapter passes `claude`.

10. Edit `packages/app/src/main/space/sessions/service.ts`: after `checkStartParams`, `adapter = adapterFor(engine)` (none: `engine-not-supported`, today's message); `skills = await readInstalledSkills(context.desk.install, context.root)`; `instructions = sessionInstructions(...)`; `launch = adapter.launch(...)` (a thrown error: `session-files-failed`); `writeSessionFiles(…, launch)`; spawn with `args: launch.args` and `env: { ...launch.env, [SESSION_ID_ENV]: sessionId }`. `readiness(engineId)` also returns `skillCount` (the count of `readInstalledSkills`, read only when the install verified).

11. Edit `packages/app/src/main/space/sessions/engine-choice.ts`: every option gets `lore: loreReadiness(adapterFor(engine), ready, skillCount)` (for an engine that cannot run a guarded session, `loreReadiness(null, …)`). `fixFor` for `engine-not-signed-in` uses the engine's catalog id: `commandId: engine-sign-in:<catalogId>`, label `Sign in to <catalog name>`, `commandLine` from `setupCommandLine`; a hand-added Claude Code uses `claude-code`.

12. Edit `packages/app/src/main/space/ipc/sessions.ts`: `spaceSkillsList` takes `{ engineId?: string }` (zod `z.strictObject({ engineId: z.string().min(1).max(256).optional() })`) and sets each skill's `invocation` from `adapterFor(engine)?.skillInvocation(name) ?? \`/lore:${name}\``.

13. Edit the shared types and contract: the M10.5 rows of 3.7.

14. Edit `packages/app/src/renderer/src/space/skills/SkillsColumn.tsx`: prop `engineId: string | null`; asks `spaceSkillsList({ engineId })` (or `{}` when null); a click types `skill.invocation`. `SpaceSessions.tsx` passes `tab.engine ?? null`.

15. Edit `EngineStartControl.tsx`: the readiness block of 3.6 under the note for the chosen option, the menu suffix of 3.6, and the renderer rule that an unguarded ticked parameter turns the guard line to `no` with `Unguarded: <options> changes the guard.`

**Tests to add or change.**

- App headless `engine-adapters.test.ts` (new):
  - every catalog entry with `guardedSessions: true` has an adapter; `adapterFor` of a hand-added `claude` binary is the Claude Code adapter; of Gemini is null;
  - each adapter's `options` is its engine's constant, and `optionsFor(default.antigravity)` is `ANTIGRAVITY_OPTIONS`;
  - the Claude Code launch for a fixture session gives today's argument list plus `--append-system-prompt <instructions>` before `--allowedTools`, the parameters first, and files `settings.json` and `mcp.json` equal to what `buildSessionSettings` and `buildSessionMcpConfig` give;
  - `sessionInstructions` for `verbsAre: 'invoked'` holds `/lore:session-orient`, and for `'listed'` one line per skill with its card path, in name order;
  - `writeSessionFiles` refuses a `LaunchFile` path `../x`, `/abs` and `a/../../b`, and writes `a/b/c.json` with folders 0700 and the file 0600.
- App headless `lore-readiness.test.ts` (new): no adapter gives three `no`; Claude Code with a ready readiness gives three `yes` and `asClaudeCode: true`; `plugin-missing` sets `lore` to `no` with its text; `python3-missing` sets `guard` to `no`; `skillCount: 0` sets `lore` to `partly`; Codex gives `asClaudeCode: false`.
- App headless `sessions.test.ts` (extend): the before-write adapter with `--dialect claude` behaves as today (the existing adapter tests pass the new argument); `--dialect nonsense` refuses with a fault; the IPC start test sees `--append-system-prompt` in the spawned arguments.
- App headless `engine-choice.test.ts` (extend): options carry `lore`; the sign-in fix of a Codex option is `engine-sign-in:codex` with label `Sign in to Codex CLI`.
- App headless `session-header-ipc.test.ts` (extend): `spaceSkillsList({ engineId: 'default.claude' })` answers `invocation: '/lore:<name>'`; with an engine id of Codex, the Codex sentence.
- Component `engine-start-control.test.tsx` (extend): the readiness block shows `Reads the Lore as Claude Code does: yes` and three lines with `Yes —`; with a Codex option it shows `partly`; ticking an unguarded parameter turns the guard line to `No — Unguarded: …`; the menu suffixes.
- Component `space-ai-session.test.tsx` (extend): a click in the Skills column types the `invocation` it was given.

**Verify.** All commands, `npm run e2e` included.

**Manual check left for the Human Lead.** A Claude Code session in a Space states that it read `ai_readme.md` (the instructions), and the start control shows `Reads the Lore as Claude Code does: yes`.

**Out of scope.** The three other adapters' `launch` and dialects.

---

### M10.6 — The Antigravity CLI adapter

**Goal.** An Antigravity session starts with the Lore plugin in its session folder, the session instructions, the verbs as skills, the session server, and the before-write check of every file tool by path; shell commands are judged by the adapter's rules; the findings are observed with the real engine.

**Depends on.** M10.5. Parallel with M10.7 and M10.8.

**Files and changes.**

1. Edit `packages/app/src/main/space/sessions/engines/antigravity.ts`, `launch`:
   - args: `[...paramArgv, '--add-dir', spaceRoot, '--add-dir', paths.dir]`.
   - env: `{}`.
   - files, under `.agents/plugins/lore/`:
     - `plugin.json`: `{"name":"lore"}` and a newline.
     - `rules/AGENTS.md`: `instructions`.
     - `skills/<name>/SKILL.md`: each installed skill's `text`, unchanged.
     - `mcp_config.json`: `{"mcpServers":{"ailore":{"serverUrl":<connection.url>,"headers":{<connection.header.name>:<connection.header.value>}}}}`, two-space indented, and a newline.
     - `hooks.json`: `{"lore-guard":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":<pre-write hook command with --dialect antigravity>,"timeout":60}]}],"PostToolUse":[{"matcher":"write_to_file|replace_file_content|multi_replace_file_content|edit_notebook|create_file|edit_file|delete_file|move_file","hooks":[{"type":"command","command":<post-write hook command with --dialect antigravity>,"timeout":90}]}]}}`. The hook commands are built with `hookArgv` and `shellCommandLine` as for Claude Code, with the same timeouts constants.
   - A session instruction line is not added; the plugin's name prefixes the MCP server, so the instructions' sentence "from the MCP server "ailore"" stays.

2. Edit `adapters.ts`, the `# dialect: antigravity` blocks:
   - Constants: `AGY_FILE_TOOLS = ('write_to_file', 'replace_file_content', 'multi_replace_file_content', 'edit_notebook', 'create_file', 'edit_file', 'delete_file', 'move_file')`; `AGY_PATH_KEYS = ('TargetFile', 'AbsolutePath', 'FilePath', 'NotebookPath', 'SourcePath', 'DestinationPath', 'Path')`; `AGY_READ_TOOLS = ('view_file', 'list_directory', 'grep_search', 'find', 'view_file_outline', 'view_content_chunk', 'view_code_item', 'find_all_references', 'codebase_search')`.
   - `written_paths`: for a name in `AGY_FILE_TOOLS`, every string value of `toolCall.args` under a key of `AGY_PATH_KEYS`; a relative one is joined to `workspacePaths[0]`; none found raises `Fault('the input of the hook names no file for the tool <name>')`. For any other name, `[]`.
   - `shell_command`: for `run_command`, `(args.CommandLine, args.Cwd or workspacePaths[0])`.
   - The pre-write decision, in this order: a file tool: run the checks on every path (any refusal: `deny` with the reason; all allowed: `allow`); `run_command`: the shell rules below; a name containing `ailore`: `allow`; a name in `AGY_READ_TOOLS`: `allow`; anything else: `ask` with no reason.
   - Shell rules: `deny` with the reason `The command is refused in a companion session: it matches the rule "<rule>".` when the command matches a pattern of `SESSION_DENY_RULES` (the text inside `Bash(…)`, `*` matching any text); `allow` when the command holds none of the characters `;`, `|`, `&`, `` ` ``, `$(`, `>`, `<`, a newline, the `Cwd` is the Space's folder, and the command equals an exact rule or starts with a prefix rule of `sessionAllowRules` (the `Bash(<text>:*)` form is the prefix `<text>`, followed by nothing or a space; the `Bash(<text>)` form is the exact text); else `force_ask` with the reason `The companion's rules do not cover this command; the Human Lead decides.` The allow and deny rules are passed to the adapter as a JSON file `shell-rules.json` in the session folder, written by the adapter's `launch` (`{"allow":[…],"deny":[…]}`, from `sessionAllowRules(tools, repositories)` and `SESSION_DENY_RULES`), and the hook command gains `--shell-rules <path>`.
   - `emit_pre`: `{"decision": <decision>, "reason": <reason>}` (no `reason` key for `allow` and `ask`).
   - `emit_post`: always prints `{}`; a problem is only noted in `refusals.jsonl` with kind `after-write` (the companion's log shows it).

3. Real-engine checks, in a scratch folder, with the installed `agy`, headless (`agy -p "<prompt>" --add-dir <space> --add-dir <session folder> --print-timeout 240s`, standard input closed), on a Space made with `makeSpaceFixture` and a session folder written by the adapter's `launch` for a registered fixture session (a small script under the scratch folder that imports the built app modules, as M4.1's `setup.mjs` did). Each check is repeated with `--dangerously-skip-permissions`.
   1. The model quotes the instructions' first sentence and lists `session-orient` among its skills.
   2. The session server sees `tools/list` with the bearer header; the model calls `await_answer` (a pending dialog answered by the test) and gets the answer. Record the exact tool name.
   3. A `write_to_file` into `lore/` in Read only is refused with the write-guard's sentence; into `workbench/` it is written (with `--dangerously-skip-permissions`); `replace_file_content` into `lore/` is refused.
   4. `run_command` `git status` runs; `echo x > lore/a.md` is refused or asks (headless: refused); `git log --output=lore/b.md` is refused by the deny rule.
   5. A hook adapter replaced for one run by a script that exits 1, then by one that sleeps past the timeout: record whether the write happens.
   6. The input of `PostToolUse` for a write.
   7. With `--dangerously-skip-permissions` on: a `run_command` that no rule covers (`touch workbench/t.md`), for which the adapter answers `force_ask`: record whether it runs, is refused, or asks.
   Record every result in a new file `packages/docs/m10-engine-findings.md`, section "Antigravity CLI", with the labels of section 2 of this document. A result that differs from section 2 is listed first, with the change it makes to the adapter, and the adapter is changed within this phase.

**Tests to add (app headless).**

- `engine-adapter-antigravity.test.ts` (new):
  - `launch` gives args with the parameters first and the two `--add-dir` in order, files at the paths of item 1 with the contents given, and a `hooks.json` whose commands carry `--dialect antigravity` and, before-write, `--shell-rules`;
  - the before-write adapter run with a JSON input for `write_to_file` into `lore/` of a Read only session prints `{"decision":"deny",…}` with the mode sentence; into `workbench/`, `{"decision":"allow"}`; a relative `TargetFile` is taken against `workspacePaths[0]`; `replace_file_content` with no path key refuses with a fault;
  - `run_command` `git status` in the Space: `allow`; `git status; rm -rf x`: `force_ask`; `git log --output=x`: `deny`; `git status` with a `Cwd` outside the Space: `force_ask`;
  - a tool named `lore_ailore_await_answer`: `allow`; `view_file`: `allow`; `browser_click`: `ask`;
  - the after-write adapter prints `{}` and notes a lore-integrity failure in `refusals.jsonl`.

**Verify.** All commands, `npm run e2e` included. The findings file exists with every check of item 3.

**Manual check left for the Human Lead.** None in this phase; M10.9 holds the interactive check.

**Out of scope.** The catalog flag (M10.9).

---

### M10.7 — The Codex CLI adapter

**Goal.** A Codex session starts with the session instructions (the verbs listed), the session server, a before-write hook on `apply_patch` given on the command line, and the read-only sandbox; the sign-in check reads the text of `codex login status` in place of its exit code; the findings are observed with the real engine (the Human Lead signs in before the phase; answer 9).

**Depends on.** M10.5. Parallel with M10.6 and M10.8.

**Files and changes.**

1. Edit `packages/app/src/main/space/sessions/engines/codex.ts`, `launch`:
   - args (the sandbox by the Human Lead's answer 7): `[...paramArgv, '--sandbox', 'read-only', '--ask-for-approval', 'on-request', '--dangerously-bypass-hook-trust', '-c', 'developer_instructions=' + tomlString(instructions), '-c', 'mcp_servers.ailore.url=' + tomlString(connection.url), '-c', 'mcp_servers.ailore.env_http_headers={' + tomlKey(connection.header.name) + '="AI_LORE_MCP_HEADER"}', '-c', 'mcp_servers.ailore.tool_timeout_sec=120', '-c', 'hooks.PreToolUse=' + preToolUse, '-c', 'hooks.PostToolUse=' + postToolUse]`, where `preToolUse` is `[{matcher="^(apply_patch|Edit|Write)$",hooks=[{type="command",command=<tomlString(pre-write hook command with --dialect codex)>,timeout=60}]}]` and `postToolUse` the same with the post-write command and `timeout=90`.
   - `tomlString(text)` is `JSON.stringify(text)` (a TOML basic string accepts JSON's escapes); `tomlKey(name)` is `name` when it matches `/^[A-Za-z0-9_-]+$/`, else `JSON.stringify(name)`.
   - env: `{ AI_LORE_MCP_HEADER: connection.header.value }` (the token is not on the command line, where `ps` shows it).
   - files: none.

2. Edit `adapters.ts`, the `# dialect: codex` blocks:
   - `written_paths`: for `tool_name` `apply_patch` (also `Edit`, `Write`), read `tool_input.command` (a string, else `Fault`); every line starting with `*** Add File: `, `*** Update File: `, `*** Delete File: ` or `*** Move to: ` gives a path (the rest of the line, stripped); a relative path is joined to `cwd`; no such line raises `Fault('the patch names no file')`. Other tools: `[]`.
   - `shell_command`: `None`.
   - `emit_pre`: `deny` prints the Claude Code JSON form; `allow` prints nothing and exits 0.
   - `emit_post`: the Claude Code form.

3. The sign-in check of Codex (the defect of section 2.4: `codex login status` exits 0 when signed out, so the `exit-code` check reads "signed in"). Observed answer when signed out: `Not logged in` on one line, exit code 0. The signed-in answer is documented as naming the method (learn.chatgpt.com/docs/auth); its exact text is Unverified, so the parser accepts any line that starts with `Logged in`.
   - Edit `packages/core/src/space/engines/catalog.ts`: `EngineSignInCheck` gains `| { kind: 'codex-login-status' } // \`codex login status\`: a line "Logged in…" = signed in, "Not logged in" = not`. Codex's entry: `signInCheck: { kind: 'codex-login-status' }`. The `exit-code` kind stays in the type (no catalog entry uses it after this phase).
   - Edit `packages/core/src/space/machine/engine-sign-in.ts`:

     ```ts
     /** The arguments of Codex's sign-in question. */
     export const CODEX_LOGIN_STATUS_ARGS: readonly string[] = ['login', 'status'];
     /**
      * Read `codex login status`'s answer (standard output and standard error
      * joined; ANSI sequences removed here): `false` when a line starts with
      * "Not logged in", `true` when a line starts with "Logged in", otherwise
      * `null`. Leading white space on a line is ignored; case is not.
      */
     export function parseCodexLoginStatus(text: string): boolean | null;
     ```
     "Not logged in" is tested before "Logged in". A private `probeCodexLoginStatus(engine, run)` follows `probeOpencodeAuthList`: timeout → `undetermined` `` `<binary> login status` did not answer in time. ``; a `failure` → `undetermined` `` `<binary> login status` could not be run (<failure>). ``; parsed `true` → `signed-in`; `false` → `not-signed-in`; `null` → `undetermined` `` `codex login status` gave an answer that was not understood. ``. The exit code is not read. `probeEngineSignIn` gains `case 'codex-login-status': return probeCodexLoginStatus(engine, run);`. Export `parseCodexLoginStatus` and `CODEX_LOGIN_STATUS_ARGS` from `packages/core/src/space/machine/index.ts`.
   - `packages/app/src/main/space/e2e-machine.ts` is not changed (its fake answer does not run the engine).

4. Real-engine checks. First run `codex login status` (standard input closed). When `parseCodexLoginStatus` of its answer is not `true`, run only check 1, write in the findings section and in the phase report the line `Codex CLI real-engine checks 2 to 5 not run: codex login status answered "<first line of the answer>" on <date>.`, and end the phase. With a signed-in account, in a scratch folder, `codex exec` with the same `-c` values and `--dangerously-bypass-hook-trust`, standard input closed:
   1. The first developer message holds the instructions (`codex debug prompt-input` with the same `-c`, which needs no account, is run in any case).
   2. The session server sees the header and `tools/list`; `await_answer` returns an answer.
   3. An `apply_patch` into `lore/` in Read only is refused with the write-guard's sentence; into `workbench/`: record whether the read-only sandbox asks or refuses.
   4. Without `--dangerously-bypass-hook-trust`: record whether the `-c` hook runs.
   5. A shell write `echo x > lore/a.md`: record that it is refused or asks.
   6. `codex login status` answers: record the exact first line when signed in, and confirm that `parseCodexLoginStatus` reads it as `true`.
   Record results in `packages/docs/m10-engine-findings.md`, section "Codex CLI".

**Tests to add.**

- Core `packages/core/test/space/machine.test.ts` (extend):
  - `parseCodexLoginStatus('Not logged in\n')` is `false`; `'Logged in using ChatGPT\n'` is `true`; `'Logged in using an API key - sk-…\n'` is `true`; `'  Not logged in'` is `false`; the same texts wrapped in ANSI colour sequences give the same answers; `''` and `'error: unexpected argument'` are `null`;
  - `probeEngineSignIn` of `default.codex` with a scripted run answering `{ code: 0, stdout: 'Not logged in\n' }` is `not-signed-in` (the defect's case); `{ code: 0, stdout: 'Logged in using ChatGPT\n' }` is `signed-in`; `{ code: 0, stdout: 'something else' }` is `undetermined` with the reason `` `codex login status` gave an answer that was not understood. ``; a `timeout` failure is `undetermined`; the scripted run is called with `CODEX_LOGIN_STATUS_ARGS`;
  - the catalog entry `default.codex` has `signInCheck.kind === 'codex-login-status'`.
- App headless `engine-adapter-codex.test.ts` (new):
  - `launch` gives the args in the order of item 1 after the parameters, no token in any argument, and `AI_LORE_MCP_HEADER` in `env`;
  - each `-c` value after `=` parses as TOML with the TOML parser already in the repository, or, if there is none, the test checks the exact strings for a fixture with a quote, a backslash and a newline in the instructions;
  - the before-write adapter with a Codex input `{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: lore/x.md\n+x\n*** End Patch"},"cwd":<space>}` of a Read only session prints the deny JSON; with `workbench/x.md` prints nothing and exits 0; a patch with `*** Update File: workbench/a.md` and `*** Move to: lore/b.md` is refused; a patch without file lines refuses with a fault.

**Verify.** All commands, `npm run e2e` included.

**Out of scope.** The catalog flag (M10.9).

---

### M10.8 — The OpenCode adapter

**Goal.** An OpenCode session starts with a config file, a config folder and permission rules in its session folder, named by environment variables: the instructions, the verbs as commands, the session server, a guard plugin that runs the before-write adapter, and the shell rules; the findings are observed with the real engine when OpenCode is installed and signed in.

**Depends on.** M10.5. Parallel with M10.6 and M10.7.

**Files and changes.**

1. Edit `packages/app/src/main/space/sessions/engines/opencode.ts`, `launch`:
   - args: `[...paramArgv]`.
   - env: `OPENCODE_CONFIG=<paths.dir>/opencode/opencode.json`, `OPENCODE_CONFIG_DIR=<paths.dir>/opencode`, `OPENCODE_DISABLE_CLAUDE_CODE=1`, `OPENCODE_PERMISSION=<the permission object below as JSON>`.
   - files:
     - `opencode/AGENTS.md`: `instructions`.
     - `opencode/opencode.json`: `{"$schema":"https://opencode.ai/config.json","instructions":[<paths.dir>/opencode/AGENTS.md],"mcp":{"ailore":{"type":"remote","url":<url>,"headers":{<name>:<value>},"enabled":true}},"permission":<permission>}`.
     - `opencode/commands/<name>.md` per installed skill: frontmatter `description: <description>` (written with the frontmatter writer of core), body `Read the card at <cardPath> and follow it. $ARGUMENTS` and a newline.
     - `opencode/plugins/lore-guard.js`: the text of a constant `OPENCODE_GUARD_PLUGIN` in `adapters.ts` (JavaScript, no dependency): it exports `export const LoreGuard = async ({ directory }) => ({ 'tool.execute.before': async (input, output) => { … } })`. For `input.tool` in `edit`, `write`, `apply_patch`, it runs `spawnSync(<python>, [<pre-write.py>, …the hook arguments…, '--dialect', 'opencode'], { input: JSON.stringify({ tool: input.tool, args: output.args, cwd: directory }), timeout: 55_000 })` from `node:child_process`; it parses standard output as `{"decision":"allow"|"deny","reason":string}`; anything but `allow` (no output, a parse error, a timeout, an exit code other than 0) throws `new Error(reason || 'The companion\'s before-write check could not be made; the write is refused. Tell the Human Lead.')`. The python path, the adapter path and the hook arguments are written into the constant's text as a JSON array when `launch` builds the file.
   - The permission object: `{"edit":"allow","external_directory":"ask","bash":{"*":"ask", …one "allow" entry per allow rule…, …one "deny" entry per deny rule…}}`, where a `Bash(<text>:*)` rule becomes the pattern `<text>*`, a `Bash(<text>)` rule the pattern `<text>`, and a deny rule its text with `*` kept; deny entries come after allow entries (the last match wins).

2. Edit `adapters.ts`, the `# dialect: opencode` blocks: `written_paths`: `write` and `edit` take `args.filePath`; `apply_patch` takes `args.patchText` and parses it as the Codex patch; relative paths against `cwd`; `emit_pre`: prints `{"decision":"allow"}` or `{"decision":"deny","reason":…}`; `shell_command`: `None`; `emit_post`: prints nothing (no after-write hook for OpenCode in this phase).

3. The Human Lead installs OpenCode and signs it in before the phase (answer 9). The tester does not install it. First run `command -v opencode` in a login shell (`zsh -lc`) and `opencode auth list` (standard input closed). When `opencode` is not found, or `parseOpencodeAuthList` of the answer is not `true`, write in the findings section and in the phase report the line `OpenCode real-engine checks not run: <opencode was not found on the PATH | opencode auth list answered "<first line>"> on <date>.`, and end the phase after the headless tests.

4. Real-engine checks with `opencode run` (standard input closed) in a scratch folder, env as in item 1, and with `opencode --version` recorded: the instructions are quoted; `/session-orient` exists as a command; the server sees `tools/list`; `write` into `lore/` in Read only is refused with the write-guard's sentence and into `workbench/` is written; `apply_patch` into `lore/` is refused; `bash` `git status` runs, `echo x > lore/a.md` asks (headless: record); with `--pure`, record whether the plugin still loads; with `--auto`, record whether the plugin still refuses. Record in `packages/docs/m10-engine-findings.md`, section "OpenCode".

**Tests to add (app headless).**

- `engine-adapter-opencode.test.ts` (new): `launch` env and files as item 1; `opencode.json` parses, names the instructions file and the server with the header; the permission object's `bash` has `"*":"ask"` first and `git status*` as `allow`; one command file per skill with the card path; the plugin file holds the absolute python and adapter paths; running the plugin's hook function with Node (import the written file in the test, with `spawnSync` of the real `python3` and the fixture's check scripts) throws with the write-guard's sentence for `write` into `lore/` and returns for `workbench/`; a python path that does not exist makes it throw the fault sentence.
- `sessions.test.ts` (extend): the before-write adapter with `--dialect opencode` refuses an `apply_patch` into `lore/`.

**Verify.** All commands, `npm run e2e` included.

**Out of scope.** The catalog flag (M10.9).

---

### M10.9 — Real-engine gate, the catalog flags, and end to end

**Goal.** Antigravity's `--dangerously-skip-permissions` is re-confirmed as not guard-changing, or moved to its guard-changing list; each engine whose adapter passed its real-engine checks is marked guarded in the catalog; the readiness texts match the findings; the end-to-end suite covers parameters, the unguarded label and the readiness block; the stage's gate is listed for the Human Lead.

**Depends on.** M10.6, M10.7, M10.8.

**Files and changes.**

1. `packages/core/src/space/engines/catalog.ts`: set `guardedSessions: true` for each engine whose section of `m10-engine-findings.md` records checks 1 to 3 of its phase as passed. Leave `false` otherwise and list why in the report.
2. The `capability` texts and states of 3.6, in each adapter file, changed where the findings differ, with the findings' section cited in a comment.
3. The Claude Code check deferred in 2.2: in a scratch folder, a headless Claude Code session started by the Claude Code adapter's arguments with `--dangerously-skip-permissions` ticked: record whether a write into `lore/` in Read only is refused. If it is not refused, the Claude Code guard line for an unguarded session says `No — Unguarded: <options> changes the guard, and the write-guard does not run.`, and the finding is recorded.
4. The Antigravity re-confirmation (the Human Lead's answer 6). In a scratch folder, a headless Antigravity session started with the Antigravity adapter's arguments and session folder, with `--dangerously-skip-permissions` ticked (it is the seed), for a Read only fixture session. Three calls, each asked for by name in the prompt, and each read in the refusals file and the transcript: `write_to_file` of `lore/m10-9-a.md`; `replace_file_content` in `lore/index.md`; `run_command` `git log -1 --output=lore/m10-9-b.md`. The re-confirmation passes when all three are refused with the adapter's reason neither `lore/m10-9-a.md` nor `lore/m10-9-b.md` exists afterwards, and `lore/index.md` is unchanged.
   - When it passes: nothing changes; the findings section "Antigravity CLI" records the run as `Re-confirmed on <date> with agy <version>: a hook refusal blocks write_to_file, replace_file_content and run_command with --dangerously-skip-permissions on.`
   - When any of the three is not blocked (the fallback): in `packages/app/src/main/space/sessions/engine-options.ts`, add `'--dangerously-skip-permissions'` to `ANTIGRAVITY_OPTIONS.guardChanging` and replace the constant's comment with `--dangerously-skip-permissions is guard-changing for Antigravity: in M10.9 a hook refusal did not block <the calls not blocked> with it on (m10-engine-findings.md).`; in `packages/app/test/headless/space/engine-options.test.ts`, change the Antigravity case to expect `unguarded` for `['--dangerously-skip-permissions']`, and remove the assertion that the list does not contain it; in `packages/app/test/component/space/engine-start-control.test.tsx`, change the Antigravity case to expect the words ` — changes the guard`, the unguarded note and the button `Start an unguarded Antigravity CLI session`; the seed parameter stays ticked by default (answer 6 only changes whether it is guard-changing); record the result in the findings and list it first in the phase report as a change for the Human Lead.
   - When Antigravity is not signed in, the check is not run, the phase report says so in the line `Antigravity re-confirmation not run: <reason> on <date>.`, and Antigravity keeps `guardedSessions: false`.

5. `packages/app/test/space-window.spec.ts` (edit): the engine menu's reason for an engine still not guarded; for a guarded one, its option; a parameter ticked on the start control reaches the stand-in engine's argument list (the e2e stand-in `claude` prints its arguments; add that if it does not); a start of the stand-in Claude Code with `--dangerously-skip-permissions` ticked shows the tab title suffix `· unguarded` and the header pill.
6. `packages/app/test/space-dashboard.spec.ts` (edit): the start control shows `Reads the Lore as Claude Code does: yes` for the stand-in Claude Code.
7. `packages/app/test/headless/space/engines-catalog.test.ts` (extend): each catalog engine with `guardedSessions: true` has an adapter whose `launch` does not throw for a fixture input.

**Verification to run and report.**

```
npm run verify
npm run lint
npm run e2e
```

Then a table in the phase report, one row per item of the stage's gate and of the gates of M10.3 and M10.5, with: automated by which test, or manual.

**Manual checks left for the Human Lead.**

- For each installed catalog engine marked guarded: start a session in a Space from the start control with its default parameters ticked; the session states it read `ai_readme.md`; a verb runs through the Skills column; asking the session to write into `lore/` in Read only is refused with the mode sentence; entering Writing through `request_writing` shows the dialog.
- Antigravity with its default `--dangerously-skip-permissions` ticked: the session is not labelled unguarded (unless M10.9's fallback applied), and asking it to write into `lore/` in Read only is refused. Claude Code with `--dangerously-skip-permissions` ticked: the tab and the session header say unguarded; after the session's first Writing, its Agents board row says unguarded.
- The readiness block of each engine reads as in 3.6, as changed by the findings.

**Out of scope.** Changes to behaviour beyond the flags and texts; a failure found here that belongs to an earlier phase goes back to that phase's owner file.
