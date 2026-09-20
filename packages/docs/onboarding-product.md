# First-run onboarding — product definition

Written 2026-09-19 for the CTO, from the Human Lead's manual check of the MVP (`.ai-lore-ai-lore-companion/memory/notepad/mvp-manual-check-feedback.note.md`, eight findings). Status: not reviewed by the Human Lead. The points that need a ruling are listed in section 9.

The Human Lead is the only user. The measure is his own daily work: from a Mac where the companion was just installed, he should reach a running AI session in a new Space without reading source code, typing a GitHub account name, or finding a command on the web.

## 1. What the onboarding is

The onboarding is everything between launching the companion and typing into the first AI session of a Space. Today it is five screens that were built one stage at a time: the welcome screen, the machine check, the setup form, the plan, and the progress view, followed by the Space window. Each works, and together they leave the Human Lead to do the joining work by hand: running commands in another terminal, typing his GitHub account, choosing a folder with no default, reading a plan written from internal fields, reading "skipped" as "not done", and meeting a Space that cannot start a session because the engine list is in the wrong order.

This document keeps the screens and the code behind them (the machine check in `core/src/space/machine/`, the step runner, the plan token, session readiness) and changes what the screens ask, what they show, and what the companion does for the Human Lead. It adds one setting and one catalog of known engines. It adds no new kind of Space and no new session mode.

Two principles change, and both are listed for a ruling in section 9:

- **The companion runs install and sign-in commands itself, on a click.** Today the machine check "installs nothing and signs in nowhere": it shows a command to copy. In this design each row has a button that runs the command in a terminal panel inside the companion window, so the Human Lead sees every line the command prints and answers any question it asks. Nothing runs without a click, and the command is shown in full next to the button before it runs.
- **Engines other than Claude Code are set up, but still cannot run a guarded Space session.** Section 3 gives the policy.

## 2. The flow, screen by screen

### Screen 1 — Launch

At every launch main runs the machine check (it takes about two seconds, `machine-checked` in the log). Which screen opens depends on the result, not on whether this is the first launch:

- When a required item is not fine (section 2, screen 2), or no Spaces folder is set, the companion opens **Set up this Mac**.
- Otherwise it opens the **welcome screen**.

So the first launch on a new Mac opens the setup screen, and so does a later launch after, for example, the GitHub token lost its `project` scope. There is no "onboarding done" flag to get out of step with the machine.

### Screen 2 — Set up this Mac

This screen replaces the machine check screen and keeps its name in the code if that is simpler. It is one page with four sections in fixed order. A section whose items are all fine collapses to one line ("✓ GitHub — signed in as alberto-conan-ui, with access to Projects"). The first section that is not fine is open. A terminal panel sits at the bottom of the page, closed until a command runs.

The page's first sentence says what it is for: "The companion needs these tools to create a Space and start an AI session in it. Press a button to install or sign in; the command runs in the panel below, where you can see it and answer its questions."

After a command started from the page exits, the companion checks that item again by itself. "Check again" stays for changes made outside the companion.

**Section A — Tools.** Three rows: git, python3, GitHub CLI (gh). Each row shows the state in words (Installed, 2.45.0 / Not installed / Too old: 2.40.0 is installed and 2.81.0 or later is needed) and one button when the state is not fine:

| Tool | Button | Command it runs on macOS |
|---|---|---|
| git | Install | `xcode-select --install` (opens Apple's installer dialog; the row says so) |
| python3 | Install | `xcode-select --install`, the same dialog; one click covers both rows |
| gh | Install | `brew install gh` when Homebrew is on the login PATH; otherwise the button is "Open the download page" and opens `https://cli.github.com` in the browser |

**Section B — GitHub.** One row, with the states and buttons below. All three commands run in the terminal panel.

| State | What the row says | Button and command |
|---|---|---|
| gh not installed | "Install the GitHub CLI first (Tools, above)." | none |
| Not signed in | "Sign in to GitHub in your browser. The companion never sees your password or token; gh keeps them." | **Sign in with the browser**: `gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project`, then `gh auth setup-git` |
| Signed in, `project` scope missing | "Signed in as alberto-conan-ui. GitHub Projects need one more permission." | **Give access to Projects**: `gh auth refresh --hostname github.com --scopes project` |
| Fine | "Signed in as alberto-conan-ui, with access to Projects. Organisations: conan-ui, …" | **Use another account…**: `gh auth login … --web` as above |

`--clipboard` copies the one-time code, and the row also shows the code in large type when the companion reads it from the panel ("First copy your one-time code: XXXX-XXXX"), with the sentence "Paste this code on the GitHub page that opened in your browser." `gh auth setup-git` makes the clone and push that setup runs use the same account.

The organisations come from `gh api user/orgs` (the default scopes of `gh auth login` include `read:org`). They are read here and cached for the setup form (screen 5).

**Section C — AI engines.** One row per engine of the catalog (section 3), in the catalog's order, then any engine the Human Lead added by hand in Settings. Each row shows two states and at most one button:

- **Installed** — Installed, 2.1.276 / Not installed. Button **Install** runs the catalog's install command.
- **Signed in** — Signed in / Not signed in / Not checked (the companion has no way to ask this engine). Button **Sign in** runs the catalog's sign-in command.

Claude Code's row is marked **Required — runs the AI sessions in a Space**. Every other row is marked **Optional** and has a line under it: "Installed and ready for AI tabs outside Spaces. Guarded Space sessions run on Claude Code only, for now." An optional engine that is not installed does not make the page "not ready".

**Section D — Spaces folder.** "New Spaces are created in this folder. You can choose another folder for any one Space." A path field with **Choose…**, prefilled with `~/Spaces` on first run. The folder is created when the Human Lead presses **Use this folder**, and the path is saved in the new setting (section 4). Until then the section is not fine.

**Bottom of the page.** When sections A, B and D are fine and Claude Code is installed and signed in, the page shows "This Mac is ready." and a primary button **Continue** that opens the welcome screen. While something required is not fine, the button is disabled and the sentence under it names what is left ("Left to do: sign in to GitHub, choose a Spaces folder.").

### Screen 3 — Welcome

As today (open a folder, the three setup entries, recent Spaces), with one change: the machine-check block becomes one line that states the setup, "This Mac is set up: GitHub alberto-conan-ui, Claude Code signed in, Spaces in ~/Spaces. Change…", where **Change…** opens screen 2. The three entries are labelled for what they do:

- **Create a new Space** — a new folder, repository and Project.
- **Make a Space from a repository on this Mac** — the repository is cloned into the new Space; the folder you pick is left as it is.
- **Open a Space from GitHub** — a Space someone (or you, on another Mac) already created.

### Screen 4 — The Space form

Three separate forms, one per entry, instead of one form whose fields appear and disappear. Every label is a plain phrase; no internal field name (`parentDir`, `folderName`, `sourceDir`, `repositoryName`, `github`) appears on screen. Below every form, always visible and updated as the Human Lead types, is a block titled **What will be created** that states the result in full.

**Create a new Space.**

- **Name** — "Also the name of the folder, the repository and the Project."
- **Description** (optional) — "One sentence about what the Space is for."
- **GitHub owner** — a drop-down with the signed-in account first, then its organisations, read on screen 2. The default is the owner used for the last Space created, else the account. No text entry.
- **Private repository** — checked by default.
- **Location** — the Spaces folder from the setting, with **Change…** for this Space only.

What will be created (example):

> Folder: `/Users/albertogutierrez/Spaces/test2` — a new folder.
> On GitHub: the private repository `alberto-conan-ui/test2` and a Project named `test2`.
> Installed for Claude Code, so AI sessions can start as soon as the Space opens.

Checks made while typing, without GitHub: the name is valid for a folder and a repository; the folder does not exist yet. When the folder exists and holds a Space of that name, the block says so and shows two buttons in place of the form's primary button: **Open it**, and **Finish setting it up** when the Space is not complete (screen 7 explains how "complete" is known). When the folder exists and is not that Space, the block says "A folder named test2 already exists in ~/Spaces and is not this Space. Choose another name or location."

The primary button is **Continue**. It starts the checks of screen 5.

**Make a Space from a repository on this Mac.**

- **Repository folder** — **Choose…**; the companion reads the folder's `origin` and shows it ("github.com/alberto-conan-ui/tool").
- **Name** — prefilled with the repository's name.
- **GitHub owner**, **Private repository**, **Location** — as for Create.

What will be created also says: "The repository is cloned into `…/tool-space/repos/tool`. The folder you chose, `/Users/…/tool`, is not changed."

**Open a Space from GitHub.**

- **Space repository** — a drop-down of the repositories of the chosen owner that hold a Space (read with one `gh` call when the owner is picked), and a text field for an address as a fallback, accepting `owner/name` or a `https://github.com/…` address.
- **Location** — as for Create.

What will be created: the folder path (location plus the repository's name), and "The Space's repositories are cloned into `repos/`; the next screen lists them."

### Screen 5 — Checking, then Confirm

**Checking.** Pressing Continue runs the dry run of today's plan (`planCreateSpace` and its siblings). While it runs, the screen shows a short list of what is being checked, each line with its own state, and the time elapsed:

> Checking GitHub…
> ✓ The repository alberto-conan-ui/test2 does not exist yet
> ◌ Looking for a Project named test2 — 4 s
> · Checking the folder

Each GitHub call has a time limit of 30 seconds. When one reaches it, the screen says which check did not answer and offers **Try again** and **Back**. The Human Lead reported a plan that took more than 69 seconds with nothing on screen (finding 6). Two engineering items come with this screen and are not product decisions: a log line per `gh` call with its duration, and finding the cause of the delay (the note points at the loop that reads the Project page by page in `github/gh-cli.ts`, which the uncommitted `missingIsNull` change touches). The target is a plan in under ten seconds for a new Space.

**Confirm.** When the checks finish, the screen shows a confirmation of at most eight lines, not the plan. It asks one question and states what will happen:

> **Create the Space test2?**
> A new folder: `/Users/albertogutierrez/Spaces/test2`
> A new private repository on GitHub: `alberto-conan-ui/test2`
> A new GitHub Project: `test2`, with its fields, labels and three views
> The Space is installed for Claude Code.
> Nothing has been created yet.
>
> [ Create the Space ]   [ Back ]
> ▸ Show every step

Things that already exist and will be reused get their own line, only when there are any: "Already on GitHub and reused: the repository `alberto-conan-ui/test`." For a half-made Space the question changes: "**Finish the Space test?** It was started before and not finished. Left to do: set up the Project." Steps already done are not listed, except under "Show every step".

**Show every step** opens today's full plan (the GitHub block, every label and view, every step with its lines), with plain wording in place of the raw `From:`/`To:`/`Count:` fields. It is there for checking, and the screen works without opening it.

The plan token of section 5.8 of the architecture document stays: **Create the Space** runs exactly the plan that was confirmed.

### Screen 6 — Running

The steps are listed in the words of today's step titles. Each has one of five states, each with its own mark and word:

| State | Mark | Word on screen |
|---|---|---|
| Not reached yet | · | Waiting |
| Running | ◌ | Running (with the current action, e.g. "Pushing to GitHub") |
| Done in this run | ✓ | Done |
| Found already done | ✓ (secondary colour) | Already done |
| Failed | ✗ | Failed |

"Skipped" is not used anywhere on the setup screens (finding 7).

### Screen 7 — Result

The result screen answers what happened in the first line and offers the next action as the primary button.

**Created or finished.**

> **The Space test2 is ready.**
> Folder: `/Users/albertogutierrez/Spaces/test2` · Repository: alberto-conan-ui/test2 ↗ · Project: test2 ↗
>
> [ Open the Space ]

When the run found steps already done, a second line says which part this run did: "The Space test had been started before. This run finished it: the Project was set up."

The three board settings that GitHub's API cannot make are shown under a heading **Three settings to make on GitHub (two minutes, can wait)**, one line each, each with a link that opens that view of the Project in the browser. They do not block opening the Space.

**Already complete.** When the checks of screen 5 find that every step is already done, the companion does not show a confirmation. It shows "**The Space test already exists and is complete.**" with the folder and links, and **Open the Space**.

**Failed.**

> **The Space test2 was not finished.**
> Stopped at: Set up the Project — GitHub refused the change: the token lacks the `project` scope.
> What was done is kept. Running again finishes the rest and does not repeat what is done.
>
> [ Fix and run again ]   [ Back to the welcome screen ]

When the failure has a fix on screen 2 (a missing scope, gh signed out, an engine not signed in), **Fix and run again** opens that row of screen 2 and, when it is fine, returns to screen 5 with the same form. Otherwise the button is **Run again**. A later launch shows the half-made Space in Recent Spaces with the note "Not finished — Finish setting it up".

**Complete** means that every step's `isDone` answers true, which the step runner already asks. No new record is kept.

### Screen 8 — The Space window and the first AI session

**Open the Space** opens the Space window on the Dashboard. The Dashboard's session button names the engine it will use: **Start a Claude Code session**. When the Space was just created, the Dashboard shows one line above the button: "The Space is ready. Start a session to begin work; it starts in Read only."

Pressing the button opens Sessions, opens an AI tab, and starts the guarded session, as today. The engine is chosen as section 3.3 says.

When session readiness refuses, the sentence is shown as today and, next to it, a button that fixes the cause:

| Readiness refuses because | Button |
|---|---|
| No engine that can run a guarded session is installed | **Set up Claude Code** — opens screen 2 at section C |
| Claude Code is installed and not signed in | **Sign in to Claude Code** — runs `claude auth login` in a terminal tab of Sessions |
| `python3` 3.8 or later is not found | **Set up python3** — opens screen 2 at section A |
| The install under the Space's desk fails verification, or does not run the write-guard first | **Install the Lore again** — runs the install step |
| The engine's arguments hold an option that changes permissions | **Edit the engine** — opens Settings, Engines, at that engine |

No refusal is shown without a button, and no refusal names a Space engine other than one the Human Lead picked himself.

## 3. Engines

### 3.1 The catalog

The companion ships a catalog of the engines it knows. A catalog entry holds the name, the binary, the install command, the sign-in command, the sign-in check, and whether the engine can run a guarded Space session. The catalog replaces `DEFAULT_ENGINES` in `main/engines.ts` (`claude` and `gemini`). Commands were checked on the makers' pages on 2026-09-19; the builder checks them again when building.

| Engine | Binary | Install (macOS) | Sign in | Signed-in check | Guarded Space session |
|---|---|---|---|---|---|
| Claude Code (Anthropic) | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude auth login` | `claude auth status --json`, field `loggedIn` (built today) | Yes |
| Codex CLI (OpenAI) | `codex` | `npm install -g @openai/codex` (needs Node.js; the row says so when `npm` is not found) | `codex login` | `codex login status`, exit code 0 when signed in | No |
| Antigravity CLI (Google) | `agy` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | `agy` (signs in through the browser on its first launch) | None known; the state is "Not checked" | No |
| OpenCode | `opencode` | `curl -fsSL https://opencode.ai/install \| bash` | `opencode auth login` (asks for the provider) | `opencode auth list`; signed in when it lists at least one provider | No |

Sources: Claude Code setup (`code.claude.com/docs/en/setup`), Codex CLI (`learn.chatgpt.com/docs/codex/cli`, `npmjs.com/package/@openai/codex`), Antigravity CLI (`antigravity.google/docs/cli/install`), OpenCode (`opencode.ai/docs`).

**Gemini CLI is removed from the catalog.** Google stopped serving it for personal and free accounts on 2026-06-18 and moved those users to Antigravity CLI. An existing `gemini` entry in the Human Lead's `engines.json` is kept as a hand-added engine.

**DeepSeek has no official coding CLI** as of 2026-09-19; DeepSeek has announced one and not shipped it. DeepSeek models are served through OpenCode: OpenCode's row carries the line "Also runs DeepSeek models: choose DeepSeek when signing in." No DeepSeek row is added, and no community DeepSeek CLI is put in the catalog. When DeepSeek ships its own CLI, adding a row is a catalog change.

**Not in the catalog now:** GitHub Copilot CLI, Cursor CLI, Amp, Aider, Goose. Each can be added by hand in Settings, Engines, as today.

### 3.2 What "set up and ready" means

An engine is **installed** when its binary is found on the login shell's PATH (the same source as today) and answers `--version`. It is **signed in** when its check says so; for an engine without a check the state is **Not checked**, shown in neutral colour, and does not count as a problem. It is **ready for Space sessions** when it is installed, signed in, and marked Yes in the last column.

Today only Claude Code is ready for Space sessions, because the write-guard, the Read only mode and the entering-Writing dialog are built on Claude Code's hooks, `--settings`, `--setting-sources ''` and `--plugin-dir` (architecture section 5.6, findings in `m4-1-claude-code-findings.md`). The other engines are ready for AI tabs outside Spaces: the v0.8 project window's AI tabs, which start any engine of the list without a guard, as today.

**The catalog entries are always present.** They are not seeded only when their binary is found, and they cannot be removed in Settings: an engine that is not installed is listed as Not installed, with **Install**. Only hand-added engines can be removed. When the companion first loads an `engines.json` written by the current version, a hand-added entry whose binary is a catalog binary (the Human Lead's re-added Claude) is merged into the catalog entry, keeping its arguments, and `removedDefaults` is dropped. This removes the cause of finding 8, where the removed and re-added Claude sat after Gemini.

### 3.3 Choosing the engine for a Space session

1. The engine this Space used last (`lastPicked`, per Space, as today), if it is still ready for Space sessions.
2. Otherwise the first catalog engine that is ready for Space sessions. Today this is always Claude Code.
3. Otherwise none, and the button becomes the fix of section 2, screen 8.

The order of `engines.json` plays no part. An engine that cannot run a guarded session is never chosen by the companion.

The picker: `+ AI` in Sessions gets a menu arrow, `+ AI ▾`. The menu lists every engine. Engines ready for Space sessions can be picked, and the pick is remembered for the Space. The others are listed greyed, with the reason on the same line: "Codex CLI — guarded Space sessions are not available for this engine yet", or "Claude Code — not signed in: Sign in…" with the fix as a link. While only one engine is ready for Space sessions, the Dashboard button does not show a menu and names that engine. The same picker, without the greying, serves the v0.8 project window's AI tabs.

### 3.4 The MVP non-goal

The non-goal "Any engine other than Claude Code" is narrowed to: **"Guarded Space sessions with any engine other than Claude Code."** In the MVP the companion installs, signs in, checks and lists Codex CLI, Antigravity CLI and OpenCode, and starts them in unguarded AI tabs outside Spaces, as it does today for any engine on the list. The Space window starts only guarded sessions, and only with Claude Code. It does not offer an unguarded session in a Space, because a session that can write the Lore without the write-guard defeats the focus's Guards condition.

A later focus can add guarded sessions for another engine by writing an adapter for its hooks: Codex CLI and Antigravity CLI are both reported to have hooks. That work is outside this document.

## 4. The Spaces folder setting

One global setting is added to the settings registry (`core/src/settings/`): **Spaces folder**, type string, a folder path, global tier. It is set on screen 2 (section D), shown in Settings under a new **Spaces** section with **Choose…**, and it prefills the Location of every form of screen 4. Each form can still choose another folder for one Space without changing the setting. The proposed first value is `~/Spaces` (section 9 asks about it). `spacesDir` in core, the companion's own data under `userData`, is a different thing and keeps its name; the new setting's key should not reuse it (for example `spaces.folder`).

## 5. The eight findings, and how the flow resolves each

1. **The owner is typed by hand; sign-in should be through the browser.** Screen 2, section B signs in with `gh auth login --web`, and adds the Project scope with `gh auth refresh -s project`, from buttons. Screen 4 offers the owner as a drop-down of the signed-in account and its organisations. There is no owner text field.
2. **A default folder for Spaces, in Settings.** The Spaces folder setting (section 4), set on screen 2, section D, shown in Settings, prefills every form.
3. **The companion should make sure the engines are there, and offer to install a missing one at session start.** Screen 2, section C lists the catalog with Install and Sign in buttons. At session start, the picker (section 3.3) and the readiness buttons (screen 8) offer the fix for an engine that is not installed or not signed in. Claude Code is required; the others are optional and set up from the same page.
4. **Choosing the folder is confusing; the page is poor overall.** Three forms instead of one; plain labels; Location prefilled; the **What will be created** block always shows the full folder path and says whether it is a new folder.
5. **The plan screen overwhelms.** Screen 5's confirmation asks one question in at most eight lines, lists what will be created, lists reused things only when there are some, and puts the full plan behind **Show every step**.
6. **Making the plan takes over a minute with nothing shown.** Screen 5's checking list names each check with its time, each GitHub call has a 30-second limit with **Try again**, each `gh` call is logged with its duration, and finding the cause of the delay is part of the work.
7. **The re-run result cannot be read.** "Skipped" is replaced by "Already done"; the form detects an existing Space of the same name and offers **Open it** or **Finish setting it up**; the confirmation of a half-made Space lists only what is left; the result says what this run did and offers **Open the Space**; a failed run says where it stopped and that running again finishes it; the manual GitHub settings come with links to their views.
8. **A new Space cannot start an AI session.** The engine for a Space session is chosen by readiness, not by the order of `engines.json` (section 3.3); catalog engines cannot be removed, which ends the removed-and-re-added Claude case (section 3.2); the button names the engine; every readiness refusal has a button that fixes its cause (screen 8).

## 6. What changes in the code, in outline

For sizing only; the architect decides the design.

- Core: the engine catalog (entries, install and sign-in commands, sign-in checks for Codex CLI and OpenCode beside the existing Claude check); the machine check reports the catalog engines and treats only Claude Code as required; a reader for the account's organisations; the Spaces folder setting.
- Main: running a command from the setup screen in a PTY with the login shell's PATH, and re-checking the item when it exits; loading `engines.json` with the catalog merge; a log line and a time limit per `gh` call; progress events from the dry run; the "complete" and "half-made" answers from the steps' `isDone`.
- Renderer: screen 2 (rewritten from the machine check screen, with the terminal panel); the three forms of screen 4 with the What will be created block; the checking list and the short confirmation of screen 5; the state words of screen 6; the three results of screen 7; the engine picker and the readiness buttons of screen 8; the Spaces section in Settings.

## 7. Out of scope

- Install commands for Linux and Windows. The Linux build stays paused in its own focus; the catalog holds macOS commands, and the row shows the maker's page on any other platform.
- Installing Homebrew or Node.js. When `brew` or `npm` is missing, the row says so and opens the maker's download page.
- Guarded Space sessions for any engine other than Claude Code, and unguarded sessions in the Space window.
- Signing engines in with API keys, choosing models, and engine updates.
- GitHub Enterprise hosts, and switching between several GitHub accounts beyond **Use another account…**.
- Making the three board settings on GitHub automatically; GitHub's API cannot.
- A guided first session, as the focus's cut line already says.
- Changes to the migration screens beyond the words "Already done" and the result's first line, which they share with setup.
- A first-launch tour or tips.

## 8. Acceptance criteria

Eleven of the twenty-five are checked by a machine on every build and name the test that does it; the other fourteen are checked by hand, because each needs a live GitHub account, a real browser flow, a real engine sign-in or a second macOS user account. The eleven were converted in stage M12 on 2026-09-20. To see a first launch without changing the Human Lead's daily setup, use a second macOS user account, or launch the companion with `GH_CONFIG_DIR` pointing at an empty folder and its user data folder moved aside.

**First launch and Set up this Mac**

1. With gh signed out, the companion opens on Set up this Mac, not on the welcome screen. Checked by hand.
2. **Sign in with the browser** opens the browser at GitHub's device page, the one-time code is on the clipboard and shown on the page, and after authorising, the GitHub row turns fine by itself, naming the account and its organisations, without pressing Check again. Checked by hand.
3. With a token that lacks the `project` scope, the row says so, and **Give access to Projects** fixes it through the browser. Checked by hand.
4. After signing in, `git clone` and `git push` of a private repository of the account work from a terminal without asking for a password. Checked by hand.
5. The engines section lists Claude Code, Codex CLI, Antigravity CLI and OpenCode, whether installed or not, and does not list Gemini CLI unless it was added by hand. Claude Code is marked Required; the others Optional. Checked by "the engines section lists all four catalog engines with Claude Code required and the others optional, whether installed or not (criterion 5)" in `packages/app/test/space-setup-criteria.spec.ts`.
6. **Install** on an engine that is not installed runs the command shown next to the button in the panel below, and the row turns Installed when the command ends. Checked by hand.
7. With Claude Code signed out, **Sign in** runs `claude auth login`, and the row turns Signed in when it ends. Checked by hand.
8. The page is not ready while Claude Code is missing or signed out, and is ready while Codex CLI, Antigravity CLI and OpenCode are all missing. Checked by "the page is ready only with Claude Code fine, and stays ready with Codex CLI, Antigravity CLI and OpenCode all missing (criterion 8)" in `packages/app/test/space-setup-criteria.spec.ts`.
9. The Spaces folder is prefilled with `~/Spaces`; **Use this folder** creates it; Settings shows the same value under Spaces. Checked by "the Spaces folder is prefilled with ~/Spaces, "Use this folder" creates it, and Settings shows the same value in the same launch (criterion 9)" in `packages/app/test/space-setup-criteria.spec.ts`.
10. With everything fine, a new launch opens the welcome screen directly, whose status line names the GitHub account, Claude Code and the Spaces folder. Checked by hand.

**Creating a Space**

11. The Create form has no field named with an internal name, and no text field for the owner. The owner drop-down lists the account and its organisations. Checked by "the Create form has no internal name and the owner is a drop-down (criterion 11)" in `packages/app/test/space-create-criteria.spec.ts`. The owner drop-down is checked for the account only: the end-to-end machine runner answers `gh api user/orgs` with an empty list whatever a fake is built with, so no test can put an organisation there. The organisations half stays a manual check.
12. Typing a name updates the full folder path, the repository and the Project in What will be created, and says the folder is new. Checked by "typing a name updates the folder, the repository and the Project, and says the folder is new (criterion 12)" in `packages/app/test/space-create-criteria.spec.ts`.
13. Typing the name of an existing complete Space in that folder shows **Open it**; the name of a half-made one shows **Finish setting it up**. Checked by "a complete Space offers Open it; a half-made one also offers Finish setting it up (criterion 13)" in `packages/app/test/space-create-criteria.spec.ts`.
14. Continue shows each check with its state within a second, and the confirmation arrives within ten seconds for a new name. Checked by hand.
15. The confirmation fits on the screen without scrolling at the window's default size, asks one question, and states the folder, the repository with its visibility, and the Project. Checked by hand.
16. While running, no step reads "skipped"; a step found done reads "Already done". Checked by "while running, no step reads "skipped", and a step found already done reads "Already done" (criterion 16)" in `packages/app/test/space-create-criteria.spec.ts`.
17. The result's first line says the Space is ready, and **Open the Space** opens it. The three GitHub settings each have a link that opens that view. Checked by hand.
18. Running Create again with the name of a complete Space leads to "already exists and is complete" and **Open the Space**, and creates nothing. Checked by "typing the name of a complete Space offers Open it and creates nothing (criterion 18)" in `packages/app/test/space-create-criteria.spec.ts`. The test proves the half that holds, that nothing is created. The other half does not match the application: once the local check finds the folder complete the Continue button is unmounted and only **Open it** remains, so "already exists and is complete" and **Open the Space** are never shown, and there is no control that asks for a fresh plan of a complete name. Either the criterion or the screen needs to change; that is the Human Lead's call.
19. Revoking the `project` scope before creating a Space leads to a result that says where it stopped and why; **Fix and run again** leads to the scope fix and then finishes the Space. Checked by hand.
20. Make a Space from a repository on this Mac says the chosen folder is not changed, and it is not changed afterwards (`git status` in it is as before). Checked by "making a Space from a repository on this Mac leaves the chosen folder unchanged (criterion 20)" in `packages/app/test/space-create-criteria.spec.ts`.

**First session**

21. In a newly created Space, the Dashboard button reads **Start a Claude Code session** and starts a Read only session with the Space's skills listed. Checked by hand.
22. With the Human Lead's current `engines.json` (Gemini first, `default.claude` removed, Claude re-added), a new Space still starts a Claude Code session, and Settings, Engines lists Claude Code once. Checked by "an awkward engines.json still starts Claude Code in a Space, and Settings lists it once (criterion 22)" in `packages/app/test/space-first-session-criteria.spec.ts`.
23. `+ AI ▾` lists Codex CLI, Antigravity CLI and OpenCode greyed with the reason on the line, and picking one is not possible in a Space. Checked by "Codex CLI, Antigravity CLI and OpenCode are greyed with a reason in a Space, and cannot be picked (criterion 23)" in `packages/app/test/space-first-session-criteria.spec.ts`.
24. In the v0.8 project window, an AI tab can start Codex CLI, Antigravity CLI or OpenCode once installed. Checked by hand.
25. With Claude Code signed out, the Space's start button shows the reason and **Sign in to Claude Code**; after signing in, the session starts without leaving the Space window. Checked by hand.

## 9. Points for a ruling

1. **The companion runs install and sign-in commands.** This replaces the M3.2 principle that the companion installs nothing and signs in nowhere. Every command runs only on a click, is shown in full before it runs, and runs in a visible terminal panel. Recommended: accept.
2. **The non-goal is narrowed** as section 3.4 words it: other engines are set up and usable outside Spaces; guarded Space sessions stay Claude Code only; no unguarded session in a Space. Recommended: accept. The alternative, an unguarded session for other engines in a Space, is not recommended because it cannot keep the Guards condition.
3. **One Settings addition, the Spaces folder,** beyond the focus's non-goal "Settings additions beyond what the current app has plus engines". Recommended: accept, and amend the non-goal.
4. **The first value of the Spaces folder.** `~/Spaces` is proposed. The Human Lead's Spaces so far are in `~/volatile`; he may want that instead.
5. **Catalog engines cannot be removed,** and `removedDefaults` is dropped with a one-time merge of `engines.json`. This changes the behaviour of Settings, Engines for Claude Code and Gemini as they are today.
6. **Where the work sits in the status tree.** It is new work in the MVP focus, found by the manual check before M8. The CTO and the Human Lead decide whether it is a new stage before M8 (through `add-stage`) or phases under M3 and M4, which are still open for their manual checks.
7. **The time limits:** 30 seconds per GitHub call during the checks, and ten seconds as the target for a new Space's plan. Both are proposals to confirm once the cause of finding 6 is known.

## 10. CTO rulings (2026-09-19, reversible by the Human Lead)

1. The app runs install and sign-in commands itself, on a click, in a visible panel. Accepted; the M3.2 principle "installs nothing, signs in nowhere" is replaced by "runs nothing without a click, and shows every command it runs".
2. The engine non-goal narrows to "guarded Space sessions with any engine other than Claude Code". Accepted.
3. The Spaces folder setting is added; the focus's Settings non-goal is amended to allow it. Accepted.
4. The Spaces folder is proposed, not assumed: the setup page prefills it with the parent folder of the most recently opened Space when there is one (for this machine, `~/volatile`), otherwise `~/Spaces`. The Human Lead confirms it on the setup page.
5. Catalog engines are always listed and cannot be removed; `removedDefaults` is dropped by a one-time merge. Accepted.
6. The work is a new stage of the MVP focus, placed before M8: `M9 — Onboarding and the first session`. M8 waits for it.
7. Time limits are set by the architect once the cause of finding 6 is measured.
