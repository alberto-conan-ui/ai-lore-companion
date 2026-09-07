# Bindings

AI-Lore is **platform-neutral plain text**. The methodology — the floor, the verb
cards, the processes, the contracts — is a folder of documents, complete on its own.
A session uses it by reading it. A **binding** layers engine-native delivery on top:
same content, automatic invocation, and — where the engine allows — mechanical
reinforcement of the contracts.

## Two paths

**Plain text.** Works on any AI, no setup. Point a session at the project and say
*"read `ai_readme.md`"*. The root shim points at the floor
(`.ai-lore-<project>/ai_readme.md`); the floor points at the thin core in
`memory/blueprint/verbs/core/`; every verb loads when invoked. This path is always
available and is the methodology in full.

**Installed.** The [`install`](./lifecycle/install.verb.md) verb projects the
**resolved** artifact set — core ⊕ parents ⊕ project-local, after shadowing — into
the engine's native forms. Nothing about the methodology changes; installing changes
*how it is delivered*. The plain-text path survives every install: after
`install claude` you can still open another engine and say *"read `ai_readme.md`"*.

The mechanical half of every binding is `ai-lore.py install <engine>`
(`blueprint/tooling/core/`). The authoring verbs keep a projection incrementally
true; a full re-projection is `install`'s job, re-run after `upgrade`, `add-parent`
/ `remove-parent`, or any change too broad for per-artifact wiring.

## What a binding projects

| Artifact | Projects to | Notes |
|---|---|---|
| verb | the engine's invocable unit | card **bundled with its family context doc** into one self-contained unit; relative links rewritten to resolve from the projected location (F11) |
| process | the engine's composition form | the process doc; its steps name verbs the engine already has |
| contract | an enforcement hook where the rule is mechanically checkable; text + citations otherwise | the layered model — stated → cited → reinforced; hooks reinforce, never carry |
| bookends | session-open / session-close hooks | orient cannot be skipped when installed; close-session stays intrinsic |

Projections are **derived state**: regenerable from the Lore, never the source of
anything. Stale projections (names no longer in the resolved set) are removed on
re-install.

## Binding: Claude

`install claude` writes the following, all idempotent on re-install.

### CLAUDE.md handshake

A delimited block, replaced in place (the rest of the file is preserved):

```
<!-- AI-LORE:BEGIN -->
This project uses AI-Lore. Read `ai_readme.md` and follow its instructions.

Every write is confirmed to a verb (the golden rule). Do not use Claude Code's built-in `/plan` in this project — AI-Lore plans by growing the status tree (`add-new-focus` / `add-stage` / `add-phase`). If you invoke `/plan` anyway, treat its plan file as scratch.
<!-- AI-LORE:END -->
```

### Verbs and processes → skills

Each resolved verb and process becomes a project-scoped skill at
`.claude/skills/ai-lore-<name>/SKILL.md`: synthesized frontmatter (`name`,
`description` from the card's title line — Claude triggers skills by description
matching), a provenance line naming the Lore source, the card's metadata (family,
track, writes, contracts), the card body, and — for verbs — the family context doc
appended under *Family context*. Every relative link is rewritten to resolve from
the skill folder; the install refuses to report success while a projected link is
dead.

### Contracts → hooks

One guard script, `.claude/hooks/ai-lore-guard.py`, wired to two hooks in
`.claude/settings.json` (matcher `Write|Edit|MultiEdit|NotebookEdit`):

- **PreToolUse — `journal-append-forward`, enforced.** A `Write`/`Edit` targeting an
  *existing* `journal/(live|archive)/YYYY-MM-DD_NN.md` is **denied**, with the
  contract named as the reason. The one core contract the engine can enforce
  outright.
- **PostToolUse — `golden-rule`, reinforced.** After every write, one line lands in
  the session's context: the write belongs to a verb the Human Lead confirmed — name
  it if you have not. Advisory by nature: a hook cannot know whether a verb was
  confirmed; the Human Lead's review can.

`ack-pairing` and `core-containment` are checked by `ai-lore.py check` (run by
`init`, `upgrade`, and at `save-point`'s contract walk), not by hooks — they are
properties of repositories, not of single writes. Writes made through the shell
(heredocs, scripts) bypass tool hooks; the text remains the floor.

### Bookends → hooks

`SessionStart` emits *"Invoke the ai-lore-orient skill now."* — the instruction lands
as the session's first turn, so an installed session cannot open without orienting.
`SessionEnd` emits the close-session instruction but is **advisory only**: the
session is already closing when it fires and gets no turn to act. close-session
works because the methodology loaded at open makes the session invoke it when it
recognizes the end — the hook is telemetry, not enforcement.

### Merge behavior

`install` creates `.claude/settings.json` if absent; otherwise it replaces only the
hook entries whose command mentions `ai-lore` and preserves every other key and
entry. `.claude/settings.local.json` is never touched. Skill folders named
`ai-lore-*` that no longer correspond to a resolved artifact are deleted; other
skills are untouched.

### Plan-mode collision

Claude Code's built-in `/plan` writes its plan file to `~/.claude/plans/`, outside
both repos. AI-Lore plans by growing the status tree on a full track. There is
nothing to redirect `/plan` to and no way to disable it, so the handshake steers
away from it by documentation; a plan file that appears anyway is scratch.

## Binding: Gemini

`install gemini` writes, idempotently:

- **`GEMINI.md` handshake** — the same delimited block, without the `/plan` line
  (Gemini CLI has no plan mode).
- **Verbs and processes → TOML slash commands** at
  `.gemini/commands/ai-lore-<name>.toml`: `description` from the card's title,
  `prompt` an `@file` injection of the card and (for verbs) its family context doc —
  thin pointers, so an edited card is live without re-install.
- **Bookends → hooks** in `.gemini/settings.json` (`SessionStart` matcher
  `startup`, `SessionEnd` matcher `exit`), emitting `additionalContext` that
  invokes the bookend commands. Same asymmetry as Claude: start reinforces, end
  is advisory by Gemini's own documentation.
- **Contracts** — no pre-write deny exists in Gemini's hook model; the contracts
  stay text + citations there.

Merge behavior mirrors Claude's: only `ai-lore` hook entries and `ai-lore-*.toml`
files are owned by the install.

The Gemini binding has not been exercised against a live project since v0.6.1
(test-by-fire deferred, recorded on the v0.6.1 focus). Treat it as the shape of the
projection, verified by inspection.

## Binding: other engines

Any engine binds by the same shape — verbs and processes to its invocable unit,
contracts to whatever pre-write gate it exposes, bookends to whatever session hooks
it has, the handshake to whatever file it auto-loads. Adding an engine is a
`tooling` change plus a section here; the methodology does not change.

## The companion app

A companion app is a **runtime**, not part of the methodology. It hosts AI-Lore
projects, reads the focus chain, and resolves every acknowledgement pair from the
ledger (`save-points/next.save-point.md` and the sealed entries — cross-repo
correlation by data, never heuristics). It is one consumer of the neutral Memory
model; the methodology never assumes it is present. The Memory file schema
([`memory.md`](./memory.md)) is what lets it parse Memory.
