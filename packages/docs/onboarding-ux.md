# Onboarding — interaction and visual design

This document covers the screens a person goes through from the first launch
of the app to the first AI session in a new Space: the welcome screen, setting
up this computer (GitHub and the AI engines), creating, opening or adopting a
Space, confirming, the run, the result, and starting a session.

The first part is an audit of the screens as they are built today, with the
concrete problems found. The second part is the redesign: layout, copy, states
and how the screens lead into one another. The product flow (what the
onboarding must achieve) is written by the CPO in `onboarding-product.md`;
where the two differ, the product document decides what, and this one decides
how it looks and reads.

The screens keep the app's dark theme and the CSS-in-JS style objects built on
the tokens of `packages/app/src/renderer/src/theme.css`. No new UI library is
proposed. A static mockup of the key screens is in `onboarding-mockups.html`.

Items marked **Proposal** need a decision from the Human Lead or the architect
before they are built, because they need something main does not do today.

---

## Part 1 — Audit of the current screens

The sources are the screens under `packages/app/src/renderer/src/space/`, the
Human Lead's eight findings in the notepad note
`mvp-manual-check-feedback.note.md`, and the two screenshots of 2026-09-19.

### Problems that apply to every screen

- **Labels are internal field names.** The form labels read `name — the
  Space's name`, `owner — the GitHub user or organisation`, `parentDir — the
  folder the Space is created in`, `sourceDir`, `folderName`, `github`,
  `repositoryName`. The machine check titles its rows `git`, `gh`, `engine`,
  `python3` and writes states as `not-signed-in`, `missing-scope`. A person
  has to translate every label before they can act on it.
- **Screens describe the mechanism, not the result.** The setup header says
  "makes the Space's folder from the Lore template and clones the repositories
  you list into repos/. A session writes the rest." The welcome screen explains
  what detection does with a v0.8 project. None of this helps the person
  decide or act.
- **Section headings name the screen's parts, not the task.** "The form",
  "The plan", "The run".
- **Waiting has no feedback.** Planning showed only the button label "Making
  the plan…" for over a minute (finding 6). No screen names the check it is
  running or how long it has run.
- **Errors state a problem without a way to fix it in the app.** The machine
  check's answer to every problem is a command to copy into a terminal, then
  "Check again". The session start refusal names the problem ("Gemini is not
  Claude Code") without a control that changes the engine.

### Welcome (`welcome/SpaceWelcomeScreen.tsx`, `welcome/SetupEntries.tsx`)

1. "Open a folder…" is the only primary button, although on a first launch
   there is nothing to open. Its description is about v0.8 migration.
2. The three setup entries are secondary buttons of equal weight, each with a
   sentence of mechanism. "Adopt a repository…" explains cloning and that the
   folder is left as it is, before the person has chosen to adopt anything.
3. When the machine is not ready, the three entries are greyed out and the
   reason below them reads like `Not available: the machine check is not
   ready. gh is missing-scope, engine is missing.` The way to fix it is a
   separate button two sections down ("Open the machine check").
4. The machine check is shown as one line near the bottom, after the entries
   it blocks.
5. For a returning person, the recent Spaces are the most likely action, and
   they are listed last.

### Machine check (`machine/MachineCheckScreen.tsx`, `machine/RequirementRow.tsx`)

1. Rows are titled by id in monospace (`gh`) with `command gh` beside them.
   The state is the raw kind (`✗ missing-scope`).
2. The app installs nothing and signs in nowhere. For every problem the person
   copies a command, switches to a terminal, runs it, switches back and presses
   "Check again". GitHub sign-in (`gh auth login`) is interactive and asks
   several questions in the terminal (finding 1).
3. The `engine` row passes as soon as one engine is fine. The engines of the
   registry are listed only when there are two or more, and an engine that is
   not installed is never in the registry, so it never appears as a choice
   (finding 3).
4. "Check again" is the primary action of the screen. The person's task is to
   fix what is missing; checking is a consequence of fixing.
5. The setup entries are repeated at the bottom of this screen, so the same
   three buttons exist on two screens with different surroundings.
6. "The commands ran with the PATH of the login shell" is shown to every
   person; it matters only when something is not found.

### Setup form (`setup/SetupForm.tsx`, `setup/SetupScreen.tsx`)

Seen in the screenshot `Screenshot 2026-09-19 at 10.14.49.png`.

1. The GitHub owner is a text field (finding 1). The app already knows the
   signed-in account.
2. The folder has no default (finding 2). It shows "No folder chosen." until
   one is picked.
3. The screen never shows the path that will be created. The fact that a
   subfolder named after the Space is made is written only in a hint under the
   name field, four fields above the folder (finding 4).
4. Create, adopt and open share one form with fields appearing and
   disappearing; the open flow's `folderName` and the adopt flow's `github` and
   `repositoryName` are optional fields shown at the same weight as required
   ones.
5. "private — the Space repository is private" is a checkbox; the choice is
   between two named options (private, public) and reads better as such.
6. The repositories block is titled "repositories — the repositories to
   include, by address" with no example of an address. It is optional and takes
   as much room as the required fields.
7. Problems that do not belong to a shown field are listed as `field: message`,
   with the internal field name.
8. The submit button is "Show the plan". Planning is a network check on
   GitHub that took more than a minute, with no progress shown (finding 6).
9. After a run was interrupted, the notice asks the person to "fill in the same
   form" again. The app knows the values; it should fill them in.

### The plan (`setup/SetupPlanView.tsx`)

1. Everything is shown at one level: the folder sentence, a GitHub block with
   every label and every view, then a numbered list of every step with every
   line built from raw fields (`From: …`, `To: …`, `Count: …`) (finding 5).
2. The screen does not say what is asked of the person. The decision is in the
   button label: "Confirm: create on GitHub and run".
3. Steps already done appear as "already done; it is skipped", so a re-run
   looks like a long list of things that will not happen.
4. For a half-made folder the only notice is one sentence ("The folder holds
   this same Space from an earlier run. What is done is kept.") inside the
   first paragraph.

### The run and its result (`setup/SetupProgressView.tsx`)

1. Steps already done are marked `– skipped` in secondary colour. "Skipped"
   reads as "not done", the opposite of its meaning (finding 7).
2. The end of a successful run is the word "Done." at the top, the list of
   steps, then "Open the Space" at the very bottom after the manual GitHub
   steps.
3. A re-run that finished one remaining step looks the same as a fresh run in
   which most steps did not happen. Nothing says "this Space already existed"
   (finding 7).
4. The three manual GitHub settings arrive as plain text with no link to the
   Project's views, and there is no way to mark them as done.
5. A failed step shows core's sentence and "Run again". When the cause is one
   the app could fix (a missing GitHub permission), there is no button for it.
6. The open flow's repository list is titled "repositories — found in the
   Space's manifest, not cloned yet".

### Starting the first session (`dashboard/StartSession.tsx`, `window/SpaceSessions.tsx`)

Seen in the screenshot `Screenshot 2026-09-19 at 10.22.23.png`.

1. There is no engine choice. Both "Start a session" and `+ AI` take the
   registry's first engine, which was Gemini (finding 8).
2. The refusal sentence ("a guarded session in a Space is started with Claude
   Code only, and "Gemini" is not Claude Code") names the problem and offers
   nothing to change it. The person cannot pick Claude Code from here.
3. The empty Sessions view gives `+ AI`, `+ shell`, `+ web` equal weight, and
   its first sentence is about the shell.
4. When `+ AI` is disabled, its reason is a tooltip and a line of text; the
   disabled button does not point to the fix.

---

## Part 2 — The redesign

### Principles used on every screen

- **Plain labels.** A label names the thing in the words a person uses:
  "Name", "Description", "GitHub owner", "Visibility", "Location". Internal
  names stay in code, `data-testid` and logs.
- **One primary action per screen**, in the bottom-right of the content column
  (bottom-left on narrow windows), with "Back" as a secondary button beside
  it.
- **State is told by a word and a mark, not by colour alone** (kept from the
  current screens). Marks: `✓` ready or done, `!` needs action, `✗` failed,
  `…` running, `·` waiting.
- **Every problem comes with an action.** An error block has the sentence,
  then a button that fixes it where the app can (Sign in, Install, Allow
  access, Try again), and "Copy command" only where it cannot.
- **Waiting names what it waits for.** Any wait longer than about one second
  shows the check under way ("Checking GitHub for the repository
  alberto-conan-ui/test"), an elapsed time after five seconds, and after a
  timeout a message with "Try again" and "Cancel".
- **Details are available, not imposed.** Audit detail (labels, views, per-step
  lines) sits in a collapsed "Show details" disclosure.

### Flow overview

```
First launch
  Welcome ─► Set up this computer ─► Welcome (ready)
                                        │
          ┌─────────────────────────────┼──────────────────────────────┐
          ▼                             ▼                              ▼
   New Space form           Space from GitHub form        Space from a repository form
          └──────────────┬──────────────┴──────────────────────────────┘
                         ▼
            Checking (inline, on the form)
                         ▼
                      Confirm ──(Back)──► form
                         ▼
                     Creating (run)
               ┌─────────┴─────────┐
               ▼                   ▼
        Failed or stopped      Space ready ─► Open it ─► Space window, Dashboard
         (fix, Try again)                                    │
                                                             ▼
                                                    Start a session (engine picker)
```

Returning launch: Welcome shows recent Spaces first; the setup of this
computer appears only when something it needs has stopped working.

A step indicator sits at the top of the setup screens: **1 Details · 2 Confirm
· 3 Create**. It is plain text, the current step in `--color-text-bright` and
the others in `--color-text-muted`. It is not clickable; "Back" moves back.

### Screen 1 — Welcome

**Layout.** One centred column, `maxWidth: 38rem` as today.

- Title "AI-Lore".
- **When this computer is not ready** (first launch, or a requirement broke):
  a card at the top, above everything else.
  - Heading: "Set up this computer"
  - Sentence: "AI-Lore needs Git, a GitHub sign-in and at least one AI engine
    before it can create a Space. 2 of 4 are ready."
  - Primary button: "Continue setup".
- **When it is ready**: no card. A one-line status at the bottom: "✓ This
  computer is ready · Check again" (link-style button).
- **Recent Spaces** (when there are any): the list as today, first in the
  column. Each row: Space name, path in monospace, "Remove" on hover and on
  focus.
- **Start** section, three entries as cards (title and one sentence each):
  - "New Space" — "Creates a Space on GitHub and in a folder on this
    computer."
  - "Space from GitHub" — "Copies an existing Space from GitHub to this
    computer."
  - "Space from a repository on this computer" — "Creates a new Space that
    includes a repository you already have."
- A secondary text button at the bottom: "Open a folder…".

On a first launch (no recents), "New Space" is the primary-styled card. When
there are recents, the first recent row has focus and the three entries are
all secondary.

**States.**
- *Checking this computer* (on launch): the card reads "Checking this
  computer…" with the current check named under it ("Checking the GitHub
  sign-in"). The Start entries stay enabled for reading; pressing one while the
  check runs waits for the check, then continues.
- *Not ready*: the Start entries are shown with `aria-disabled` (as today), and
  the sentence under them is "Finish setting up this computer first." with a
  link-style button "Continue setup". No raw state names.
- *Error opening a folder*: an inline message under "Open a folder…", in
  `--color-warn-fg`, as today.

### Screen 2 — Set up this computer

Replaces the machine check screen. Same column width (`46rem`).

**Header.** Title "Set up this computer". Sentence: "AI-Lore uses these tools
on this computer. Items marked Required must be ready before you create a
Space." Secondary button top-right: "Back".

**Rows.** Each row is a card (`--color-shell-deep`, `--color-border`, radius
6px) with four columns: name and one-line purpose, the state (mark and word),
and one action button on the right. Rows in this order:

| Row | Purpose line | States and their action button |
|---|---|---|
| **Git** · Required | "Keeps the history of your Spaces." | Ready (version shown in muted text) · Not installed → "Install" · Too old → "Update" |
| **GitHub** · Required | "Stores each Space and its Project." | Signed in as `alberto-conan-ui` · Not installed → "Install" · Not signed in → "Sign in with GitHub" · Missing access to Projects → "Allow access" |
| **Python 3** · Required | "Runs the check that protects your files during AI sessions." | Ready · Not installed → "Install" |
| **AI engines** · At least one required | "The programs that run AI sessions." | Sub-list, see below |

**GitHub sign-in in the browser.** Pressing "Sign in with GitHub" starts
`gh auth login --web` with the `project` scope requested at the same time
(`-s project`), so the person does not need a second step later. The row
changes to:

> Waiting for you in the browser. Enter this code on GitHub:
> **ABCD-1234** [Copy code] · [Open GitHub again] · [Cancel]

When `gh` reports success the row becomes "✓ Signed in as alberto-conan-ui".
"Allow access" for a missing `project` scope runs `gh auth refresh -s project`
with the same code panel. If the person closes the browser, the row returns
to "Not signed in" with the sentence "The sign-in was not finished." and the
button again.

**AI engines sub-list.** One line per known engine, installed or not:

| Engine | State and action |
|---|---|
| Claude Code | ✓ Ready · or "Not installed" [Install] · or "Not signed in" [Sign in] |
| Codex CLI | same states |
| Antigravity CLI | same states |
| OpenCode | same states |

Under the list, in muted text: "In this version AI sessions in a Space run
with Claude Code. The other engines can be installed now and are used in the
cockpit." (The exact list of engines and their install commands is to be
verified, as noted in finding 3.)

The engine row header reads "✓ Ready — Claude Code can run Space sessions"
when Claude Code is ready, and "! Needs Claude Code" otherwise, even if
another engine is installed, because only Claude Code can start a Space
session today.

**Install and Sign in for engines — Proposal.** "Install" opens a panel under
the row that shows the exact command and two buttons: "Run" and "Copy
command". "Run" runs the command and shows its output in the panel (a
read-only log view, monospace, `--color-code-bg`). When the command ends, the
row checks itself again. Engine sign-in is interactive in each engine's own
program, so "Sign in" opens the system terminal with the engine's sign-in
command; when the app's window regains focus, the row checks itself again.
Today the app installs nothing (`MachineCheckScreen.tsx` doc comment), so
this needs a decision.

**States of the screen.**
- *Checking*: every row shows "…" and its own check name ("Looking for Git",
  "Checking the GitHub sign-in", "Looking for Claude Code"). The rows fill in
  as their checks return, not all at the end.
- *Ready*: a line above the rows in `--color-success-fg`: "✓ This computer is
  ready." Primary button at the bottom: "Continue". It returns to Welcome, or
  to the flow the person was starting.
- *Not ready*: the line reads "2 items need your attention." in
  `--color-warn-fg`. "Continue" is disabled with that sentence as its
  description.
- *Check failed to run*: "The check did not run: {reason}." with "Try again".
- The row checks itself again after its own action ends, and the whole screen
  re-checks when the window regains focus. A small "Check all again" text
  button stays at the bottom for the case the app cannot see.
- The PATH note is shown only when something is not found: "Searched the
  folders of your login shell's PATH." with a disclosure "Show the folders".

### Screen 3 — New Space form

**Header.** Step indicator "1 Details". Title "New Space". Sentence: "A Space
is a GitHub repository with a Project, and a folder on this computer."

**Fields, in order:**

1. **Name** — text input, autofocus. Hint under it: "Used for the folder, the
   repository and the Project." Invalid characters are reported live in
   `--color-danger-fg` (core's sentence).
2. **Description** — textarea, 3 rows. Label "Description (optional)" if core
   allows empty; otherwise "Description". Placeholder: "What this Space is
   for."
3. **GitHub owner** — a select, filled from the signed-in account and its
   organisations: first entry the account ("alberto-conan-ui (you)"), then a
   separator, then each organisation. Default: the account, or the owner used
   last. Under it, muted: "Signed in as alberto-conan-ui · Not listed? Your
   organisation may need to allow access for the GitHub CLI." with a link to
   the GitHub page for application access. When not signed in, the select is
   replaced by the GitHub row of Screen 2 inline, with "Sign in with GitHub".
4. **Visibility** — two radio options in one row: "Private" (default) and
   "Public", each with a muted line: "Only you and people you add can see it."
   / "Anyone can see it."
5. **Location** — the default folder from Settings, shown as a path in
   monospace, with "Change…" beside it (the system folder dialog). Under it, a
   **live result line** in the regular text colour, updated on every keystroke
   in Name:

   > Will create `/Users/albertogutierrez/volatile/test`

   With an empty name: "Enter a name to see the folder that will be created."
   When the folder exists: see the checking states below. When no default is
   set and none chosen: "Choose a folder…" as the only content, and under it
   "You can set a default folder in Settings." — **Proposal** for the setting:
   "Default folder for Spaces", global tier, string (finding 2).
6. **Repositories to include (optional)** — collapsed by default as a
   disclosure: "Add repositories (optional)". Open, each row has "GitHub
   address" (placeholder `owner/name` or `https://github.com/owner/name`) and
   "Name in the Space (optional)", and "Remove". Button "Add another". Muted
   line: "You can add repositories later."

A summary line above the primary button, muted, shows what GitHub will get:
"On GitHub: repository alberto-conan-ui/test (private) and Project test."

**Actions.** Primary "Continue" (was "Show the plan"). Secondary "Back". The
hint "Nothing is created before you confirm." stays next to the button.

**Checking (the plan) — inline on the form.** Pressing Continue keeps the form
on screen, disables it, and shows a panel under the button:

```
Checking before anything is created                       0:07
  ✓ This computer is ready
  ✓ The folder /Users/albertogutierrez/volatile/test is free
  … Checking GitHub for the repository alberto-conan-ui/test
  · Checking GitHub for the Project "test"
  · Checking the Project's fields and views
                                                        [Cancel]
```

Each line is one check the plan makes. This needs main to report progress
while it plans (finding 6 asks for a log line per GitHub call; the same events
drive this panel) — **Proposal**. Until that exists, the panel shows the one
line "Checking GitHub for alberto-conan-ui/test…" with the elapsed time.

- After 20 seconds, a muted line: "GitHub is slow to answer. You can keep
  waiting or cancel."
- After a timeout (value to be set by the architect), the panel becomes an
  error: "GitHub did not answer within 60 seconds. Nothing was created." with
  "Try again" and "Cancel".

**Form problems.** Each problem is core's sentence under its field, with the
field outlined in `--color-danger-fg`. A problem that belongs to no shown field
is listed at the top under "Fix these before continuing:" with the plain field
label ("Location: the folder is not writable"), never the internal name.

**Live folder check.** When the resulting folder already exists, the result
line changes, before Continue is pressed:

- Empty folder: "Will use the empty folder `/…/test`."
- Same Space from an earlier run: "`/…/test` holds this Space from an earlier
  run. Continuing finishes it." in `--color-warn-fg`, with the Continue button
  relabelled "Continue and finish it".
- Anything else: "`/…/test` already exists and holds other files. Choose
  another name or location." in `--color-danger-fg`; Continue is disabled.

### Screen 3b — Space from GitHub (open by address)

Same layout and header ("Space from GitHub").

1. **Space on GitHub** — text input, placeholder `owner/name`. **Proposal**:
   under it, a list "Your Spaces on GitHub" of repositories of the account and
   its organisations that are Spaces, each a one-click choice.
2. **Location** — as in the New Space form, with the live result line "Will
   create `/…/<repository name>`".
3. A disclosure "Use a different folder name" with one text input, "Folder
   name". When filled, the result line uses it.

Continue leads to the same checking panel and the same Confirm screen.

### Screen 3c — Space from a repository on this computer (adopt)

Header "Space from a repository on this computer". The chosen repository is
shown first, read-only, as a card:

> **Repository:** `/Users/albertogutierrez/code/my-app`
> **On GitHub:** github.com/alberto-conan-ui/my-app (read from the repository's origin)
> The new Space gets its own copy from GitHub. This folder is not changed.

When the origin cannot be read: "This repository has no GitHub address. Enter
it below." and the "GitHub address" field is shown open.

Then the fields of the New Space form (Name prefilled with
"<repository>-space" — **Proposal**, the product document may choose another
default; Description; GitHub owner; Visibility; Location with the result line).
A disclosure "More options" holds "GitHub address" (prefilled from origin) and
"Name in the Space" (placeholder: the repository's name).

### Screen 4 — Confirm

Step indicator "2 Confirm". Title: "Check and create". Sentence: "Check these
three things. Nothing has been created yet."

**The three things to check**, as a card with three rows, each with a state
tag on the right:

| Row | Value | Tag |
|---|---|---|
| Folder | `/Users/albertogutierrez/volatile/test` | New · Already exists, will be used |
| GitHub repository | alberto-conan-ui/test · Private | New · Already exists, will be used |
| GitHub Project | test | New · Already exists, will be used |

Tags use a neutral pill (`--color-neutral-pill`) for "New" and an amber tag
(`--color-amber-tag-*`) for "Already exists, will be used".

**Half-made Space.** When the plan finds steps already done, a banner above the
card (`--color-warn-banner-*`):

> **This Space was partly created before.** 7 of 9 steps are done. Continuing
> runs the 2 that are left: Set up the Project, Record where every root
> starts.

**Details, collapsed.** A disclosure "Show all details" with, inside: the
labels and views that will be made on the Project, and the steps in order,
with "Already done" or "Will run" for each. Step lines use the step's own
words; the raw `From:` / `To:` / `Count:` pieces are written as a sentence
("Clones github.com/x/y into repos/y").

**Actions.** Primary button with the literal act: "Create the Space" (create
and adopt), "Copy the Space to this computer" (open by address), or "Finish
the Space" (half-made). Secondary "Back". The primary button has focus when the
screen opens (so Enter confirms), and the heading is announced to screen
readers as today.

**Plan error.** The card is replaced by an error block: core's sentence, the
line "Nothing was created.", and an action that fits the error — "Sign in with
GitHub" or "Allow access" for GitHub access errors, "Choose another name" (back
to the form with Name focused) for a name conflict, "Try again" otherwise.

### Screen 5 — Creating (the run)

Step indicator "3 Create". Title "Creating test". The column shows:

- **The current step**, large: "Setting up the Project…" with elapsed time.
- **The list of steps**, one per line, with these words (replacing the raw
  state names):

| Internal state | Shown as | Mark and colour |
|---|---|---|
| waiting | Waiting | `·` `--color-text-muted` |
| checking | Checking | `…` `--color-text-secondary` |
| running | Running | `…` `--color-text-bright`, row highlighted with `--color-rail-active` |
| done | Done | `✓` `--color-success-fg` |
| skipped | Already done | `✓` `--color-text-secondary` |
| failed | Failed | `✗` `--color-danger-fg` |

"Already done" uses the same check mark as Done, in a quieter colour, so a
re-run reads as a list of finished steps.

- **Stop** as a secondary button, with the muted sentence: "Stops after the
  current step. What is done is kept."

**Failed or stopped.** The failed step's row expands with core's sentence and
the fix action where one exists:

- missing `project` scope → "Allow access to GitHub Projects" (runs `gh auth
  refresh -s project`, with the code panel of Screen 2), then the run
  continues by itself when access is granted;
- network or GitHub error → "Try again";
- other errors → "Copy the error" and "Try again".

Above the list: "Stopped at: Set up the Project. What was done is kept.
Trying again continues from this step." Buttons: primary "Try again",
secondary "Back to the form".

**Window closed during a run.** Next time the person starts the same flow, the
form opens filled with the values of the interrupted run (**Proposal**: main
keeps them with the interrupted record) and a banner: "Creating test stopped
when its window closed. Continue to finish it." with the primary button
"Continue".

### Screen 6 — Space ready

Replaces "Done." and the list.

**Fresh creation.**

> ✓ **Space ready**
> test was created in `/Users/albertogutierrez/volatile/test` and on GitHub as
> alberto-conan-ui/test.
>
> [Open the Space]  (primary, focused)   View on GitHub (link)

**Re-run of a half-made Space.**

> ✓ **Space ready**
> test already existed; finished the remaining step: Set up the Project.
>
> [Open the Space]

With several remaining steps: "test already existed; finished the 2 remaining
steps: Set up the Project, Record where every root starts."

**Open by address**, repositories not cloned yet: a card "Repositories of this
Space" with a checkbox per repository ("my-app · github.com/x/my-app"), all
ticked by default, and "Copy the ticked repositories" as a secondary button.
"Open the Space" stays primary; the person can copy the repositories later.

**The GitHub settings to make by hand**, below, as a checklist card:

> **Three settings to make on GitHub**
> GitHub does not allow apps to change these view settings. Each takes a few
> seconds.
>
> ☐ In the view **Focuses by Stage**, set "Column by" to the field **Stage**.
>   [Open this view]
> ☐ In the view **Items by focus**, set "Group by" to **Parent issue**.
>   [Open this view]
> ☐ In the view **Agents board**, set "Column by" to the field **Agents**.
>   [Open this view]
>
> You can do this later. The Dashboard lists what is left.

"Open this view" opens the view's URL in the browser (the view number is known
from the setup step; allowed by the app's rule of opening only web addresses).
Ticking a box is the person's own record; **Proposal**: the ticks are stored
with the Space so the Dashboard can list what is left, and the Dashboard shows
the same checklist until all three are ticked.

The checklist sits below "Open the Space" so it does not block the main
action.

### Screen 7 — Start a session

Applies to the Dashboard's "Start a session" and to the Sessions empty view.

**The engine picker.** "Start a session" becomes a split control: the button
names the engine that will run, and a menu button beside it opens the list.

```
[ Start a session with Claude Code ][▾]
```

The menu lists every engine of the registry and every known engine that is
not installed, in two groups:

- **Can start here** — engines for which `spaceSessionReadiness` answers
  ready. Each is a selectable item: "Claude Code · Ready".
- **Cannot start here** — disabled items with the reason and, where the app can
  act, an action link in the item:
  - "Gemini CLI — AI sessions in a Space run with Claude Code only in this
    version."
  - "Codex CLI — Not installed. [Install]"
  - "Claude Code — Not signed in. [Sign in]" (when that is the case)

The default is the engine used last in this Space if it can start, otherwise
the first engine that can start. An engine that cannot start is never the
default, which removes the Gemini case of finding 8 without asking the person
to reorder their engines.

The sentence under the control states what will happen: "Starts Claude Code in
this Space's folder, in Read only. Writing needs your confirmation."

**When no engine can start.** The control is replaced by a card:

> **No AI session can start yet**
> AI sessions in a Space need Claude Code, and Claude Code is not installed.
> [Install Claude Code]  [Open engine settings]

The sentence changes with the cause from readiness, each with its action:

| Cause | Sentence | Action |
|---|---|---|
| Claude Code not in the registry or not installed | "…need Claude Code, and Claude Code is not installed." | Install Claude Code |
| Claude Code not signed in | "Claude Code is installed and not signed in." | Sign in |
| `python3` not found | "Python 3 is needed for the check that protects your files, and it was not found." | Open setup of this computer |
| The Space's install for Claude Code fails its check | "This Space's setup for Claude Code is incomplete." | Repair (re-runs the install step) — **Proposal** |

**Sessions empty view.** Title "Sessions". The AI entry comes first and uses
the same split control as the Dashboard. Under it, "Other tabs:" with the two
secondary buttons "Terminal" and "Web page" (replacing `+ shell`, `+ web`).
The `+ AI` button in the tab bar opens the same engine menu.

**Starting.** After the press, the button shows "Starting Claude Code…" and the
tab opens. If the start fails after readiness (desk, record, connection), the
tab shows core's sentence with "Try again" and "Choose another engine".

---

## Visual design notes

**Tokens.** Only existing `theme.css` tokens are used. The main ones:

| Use | Token |
|---|---|
| Page background | `--color-shell` |
| Cards and rows | `--color-shell-deep`, border `--color-border`, radius 6px |
| Inputs | `--color-inset`, border `--color-border-strong`, radius 4px |
| Focus ring | 2px `--color-accent` outline, offset 2px |
| Primary button | `primaryButtonStyle` (`--color-surface-blue`) |
| Selected option (radio card, selected engine) | border `--color-accent-border`, background `--color-surface-blue` |
| Text: body / secondary / muted | `--color-text` / `--color-text-secondary` / `--color-text-muted` |
| Success / warning / danger text | `--color-success-fg` / `--color-warn-fg` / `--color-danger-fg` |
| Warning banner | `--color-warn-banner-bg`, border `--color-warn-banner-border` |
| Tags | `--color-neutral-pill` (New), `--color-amber-tag-*` (Already exists) |
| Paths, commands, codes | the monospace stack of `folderPathStyle` |
| Links | `--color-link` |

**Type scale** (kept from the current screens): screen title 1.1rem/600, section
title 0.95rem/600, body 0.85rem, hints 0.78–0.8rem, labels 0.8rem/600 in
`--color-text-2`. The live result line ("Will create …") uses 0.85rem with the
path in monospace in `--color-text-bright`, so it is the most visible line of
the Location field.

**New shared style objects** to add to `space/styles.ts`, so the onboarding
screens do not each redefine them: `cardStyle`, `rowCardStyle`,
`stateTagStyle(kind)` (ready, action, failed, muted), `fieldLabelStyle`,
`hintStyle`, `inputStyle`, `resultLineStyle`, `disclosureStyle`,
`stepIndicatorStyle`, `bannerStyle(kind)`. The screens today each define
their own `hintStyle` and `labelStyle` with slightly different sizes.

**Components** to add under `space/`: `StatusRow` (name, purpose, state, one
action; used by Screen 2 and the engine menu), `GitHubSignIn` (button, code
panel, result; used by Screen 2, the form and the run's fix action),
`OwnerSelect`, `LocationField` (with the live result line), `Disclosure`,
`StepList` (the run's list with the state words above), `ByHandChecklist`,
`EngineStartControl` (split button and menu). All are plain React with style
objects, as today.

**Accessibility**, kept and extended: `output` for live status lines; the
current check in the checking panel and the current step in the run are in an
`aria-live="polite"` region; disabled engine items keep `aria-disabled` and are
reachable by keyboard so their reason is read; the code panel's code is
selectable text and has its own "Copy code" button; focus moves to the heading
of each new screen, and to "Open the Space" on the result screen.

## Copy reference

| Where | Current | New |
|---|---|---|
| Welcome entry | Create a Space | New Space |
| Welcome entry | Open a Space by GitHub address | Space from GitHub |
| Welcome entry | Adopt a repository… | Space from a repository on this computer |
| Machine check title | Machine check | Set up this computer |
| Requirement names | `git`, `gh`, `engine`, `python3` | Git, GitHub, AI engines, Python 3 |
| States | `missing`, `not-signed-in`, `missing-scope`, `too-old`, `undetermined` | Not installed, Not signed in, Missing access to Projects, Too old, Could not check |
| Form heading | The form | (none; the step indicator shows "Details") |
| Label | name — the Space's name | Name |
| Label | description — what the Space is about | Description |
| Label | owner — the GitHub user or organisation | GitHub owner |
| Label | private — the Space repository is private | Visibility: Private / Public |
| Label | parentDir — the folder the Space is created in | Location |
| Label | folderName — … (optional) | Folder name (under "Use a different folder name") |
| Label | sourceDir — the repository to adopt | Repository |
| Label | github — the repository as owner/name (optional) | GitHub address |
| Label | repositoryName — its name in the Space (optional) | Name in the Space |
| Label | repositories — the repositories to include, by address | Add repositories (optional) |
| Button | Show the plan / Making the plan… | Continue / Checking… |
| Plan title | The plan | Check and create |
| Confirm | Confirm: create on GitHub and run | Create the Space |
| Confirm | Confirm: clone and run | Copy the Space to this computer |
| Run title | The run | Creating {name} |
| Step state | skipped | Already done |
| End | Done. | Space ready |
| Re-run end | (none) | {name} already existed; finished the remaining step: {step}. |
| By hand | Left to do by hand on GitHub | Three settings to make on GitHub |
| Session start | Start a session | Start a session with {engine} |
| Session refusal | …a guarded session in a Space is started with Claude Code only, and "Gemini" is not Claude Code. | Gemini CLI — AI sessions in a Space run with Claude Code only in this version. (in the engine menu, not as the only message) |
| Sessions empty | + AI · + shell · + web | Start a session with {engine} · Terminal · Web page |

## Open questions for the product document

1. Whether the app installs tools itself (Screen 2 "Run"), or only shows and
   copies commands. The design works with either; the "Run" button is the only
   difference.
2. Whether the Settings gain "Default folder for Spaces", and its first value
   (the design assumes `~/Spaces` is suggested on the first run, with the
   person able to change it before the first Space).
3. The default name for a Space made from a repository.
4. Where the ticks of the GitHub checklist are stored, and whether the
   Dashboard shows the checklist.
5. The list of engines offered in Screen 2 and their install and sign-in
   commands (finding 3 lists candidates to verify).

## CTO rulings on the proposals (2026-09-19, reversible by the Human Lead)

Where this document and `onboarding-product.md` differ on what the flow does, the product document governs; this document governs how it looks and reads.

- The app runs install and sign-in commands on a click, with the command and its output shown: accepted (see product doc section 10).
- "Default folder for Spaces" setting: accepted.
- Main reports each check while making the plan, with elapsed time; the timeout value is set by the architect from the measured cause of finding 6.
- Prefilling the form after an interrupted run: accepted.
- Storing the manual GitHub checklist ticks: not in this stage. The checklist is shown on the result screen with links; nothing is stored.
- "Repair" for a Space whose Claude Code install is incomplete: accepted, as the fix button on that readiness refusal (it re-runs the install step).
- Default name for a Space made from a repository: the repository's name.
