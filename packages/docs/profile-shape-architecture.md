# M14 — the profile shape: technical design and phase specifications

Written 2026-09-20 by the architect of stage M14 "the profile shape" of the focus `mvp-ai-lore-1-0`. Status: not reviewed by the Human Lead.

Inputs, in order of authority:

1. The Human Lead's approval of 2026-09-20, as the CPO, recorded in the stage file `M14-the-profile-shape.stage.md`: 1.0 ships the profile shape and nothing else of the 1.1 note.
2. `.ai-lore-ai-lore-companion/memory/notepad/ai-lore-1.1-ai-lead.note.md`, sections "Cost and models" and "What 1.0 must do for this". The rest of that note — the AI Lead, the runtime that outlives its windows, supervision, delegation, the control surface — is not approved and appears nowhere in this document.
3. `mvp-architecture.md`: the architecture, section 5.6 (sessions and the write-guard), the coding standards (section 6), the testing strategy (section 8) and the definition of done for a phase (section 8.7).
4. `m10-architecture.md`: section 3.4 (the parameter model) and its migration, which is the precedent this document follows; and the phase format of its section 5.

Section 1 states what M14 adds. Section 2 records what is stored today, including what was read on the Human Lead's own machine. Section 3 is the design. Section 4 lists the decisions this document takes and the questions it leaves for the Human Lead. Section 5 is one specification per phase.

---

## 1. What M14 adds

The unit of configuration stops being the engine and becomes a named profile: an engine, a model, and its parameters. A role points at a profile. In 1.0 there is one profile per engine and it behaves exactly as the engine does today.

In one list:

- A `Profile` type in core, with an id, a name, an engine, an optional model and its parameters (section 3.1).
- A settled answer to what identifier is written into the desk's records and onto the Agents board from now on (section 3.2).
- A session record that carries, from its start, the profile that ran and the parameters it ran with, and, at its close, what it spent (sections 3.2 and 3.6).
- `EngineEntry.helperModel` reconciled into the profile's `model` (section 3.5).
- Nothing else. Starting a session, the start control, the guard, the parameters and their default ticks behave exactly as they do today (section 3.7).

### 1.1 Why the identifier is the point

The reason this is in 1.0 is not that the shape is tidy. The engine's identifier is already written into the desk's `sessions.json`, into the baseline picker's session-close points, and into the title and body of every session issue on the Agents board, and more of it is written every day the Space is worked. An identifier changed after those records exist is a migration of stored data, not a change of code.

The whole of section 3.2 exists to answer three questions: what identifier is written from now on, whether anything already written needs migrating, and how a record written before this change is read afterwards.

---

## 2. What is stored today

### 2.1 Where an engine's identifier is stored

| Where | File | Field | What it holds |
|---|---|---|---|
| The engine registry | `<userData>/engines.json` | `engines[].id` | `default.claude`, `default.codex`, `default.antigravity`, `default.opencode` for the catalog engines; whatever the Human Lead typed for a hand-added one. |
| A Space's desk | `<userData>/spaces/<key>/desk/sessions.json` | `records[].engine` | The `id` above, written by `startSession` at every session start. |
| A Space's window state | `<userData>/spaces/<key>/ui/session-engine.json` | `engineId` | The engine this Space's sessions start with. |
| A project's state | `<userData>/projects/<hash>/engine-state.json` | `lastPicked`, `helperEngine` | The v0.8 AI tab's engine and the read-only helper's engine. |
| GitHub | The session issue's title and body | in prose | `The default.claude session that started at 2026-09-19T14:14:29.140Z`. |

The session issue's own identifier is its hidden marker, `formatIssueMarker('session-issue', sessionId)`, which carries the session's id and no engine id (`packages/core/src/space/project/session-issue.ts`). The engine id is on the board as text only.

### 2.2 What is on the Human Lead's machine

Read on 2026-09-20, read-only, from `~/Library/Application Support/`:

- `AI-Lore/engines.json` holds five entries, in catalog order: `default.claude`, `default.codex`, `default.antigravity` (with the seeded `--dangerously-skip-permissions` parameter and its derived `args`), `default.opencode`, and a hand-added `default.gemini` (binary `gemini`) last. No entry has `helperModel`. The awkward state the stage describes — Gemini first, `default.claude` removed, Claude re-added under another id — has already been repaired by `mergeEnginesWithCatalog` (M9.3, M9.4): the merge put the catalog entries first, matched the re-added Claude by its binary name and gave it back the id `default.claude`. What remains awkward is `default.gemini`: a hand-added entry whose id follows the catalog's naming and is not in the catalog.
- `AI-Lore/spaces/*/desk/sessions.json` holds nine session records across four Spaces: seven `default.claude`, one `default.codex`, one `default.antigravity`. Every one of them is a catalog id. None carries an id that `engines.json` no longer has.
- `AI-Lore 1.0/` is the separate 1.0 application's data folder (commit 3393d9e). It holds one Space, whose `sessions.json` has no records, and it has no `engines.json` at all: the first load of the 1.0 build writes one from the catalog.

Two consequences for this design. First, the migration this stage feared is smaller than the stage assumed: every stored engine id is a catalog id, and the merge already normalises a hand-added Claude. Second, the design still has to be right, because the 1.0 build starts its own store and will write its own records from here on.

### 2.3 `helperModel` today

`EngineEntry.helperModel` is read in exactly one place, `packages/app/src/main/ipc/helper.ts` line 172: `model: engine.entry.helperModel ?? GEMINI_HELPER_MODEL`. It is written in exactly one place, `SettingsSheet.tsx` line 1200, which carries it across an edit; there is no input for it, so the Human Lead cannot set it in Settings today. The Claude helper ignores it entirely and runs the constant `HELPER_MODEL = 'haiku'`.

---

## 3. Design

### 3.1 The profile

New file `packages/core/src/space/engines/profiles.ts`, beside `catalog.ts` and `merge.ts`, exported from `packages/core/src/space/engines/index.ts`. `packages/core/src/space/index.ts` already re-exports that barrel, so no other barrel changes.

```ts
/**
 * A named profile: an engine, a model, and the parameters a session can start
 * with. In 1.0 there is one profile per engine, and it is the engine entry of
 * `engines.json` read as a profile.
 */
export type Profile = {
  /** Stable identifier. It is the `id` of the entry in `engines.json` (section 3.2). */
  id: string;
  /** Display name. */
  name: string;
  /** The engine the profile runs: a catalog id, or `null` for a hand-added engine. */
  engine: EngineCatalogId | null;
  /** The binary: an absolute path, or a bare name resolved on PATH at spawn. */
  binary: string;
  /**
   * The model the profile runs, in the engine's own naming (Claude: `opus`;
   * Gemini: `gemini-2.5-flash`). Absent: the engine's own default. What uses it
   * in 1.0 is section 3.5.
   */
  model?: string;
  /** The parameters, in order. Empty when the profile has none. */
  params: EngineParam[];
};
```

Functions in the same file:

```ts
/** The profile an engine entry is read as. */
export function profileOf(entry: EngineEntry): Profile;

/** The engine entry a profile is stored as. `args` is derived as `parseEngineEntry` derives it. */
export function entryOf(profile: Profile): EngineEntry;

/** The profile of `id` in `profiles`, or `null`. */
export function profileById(profiles: readonly Profile[], id: string): Profile | null;

/**
 * How the profile's engine is named in a stored record: its catalog id, or, for
 * a hand-added engine, the file name of its binary in lower case with `.exe`
 * removed (the same key `merge.ts` matches binaries by).
 */
export function engineNameOf(profile: Profile): string;
```

`profileOf` sets `engine` to `catalogEntryFor(entry)?.catalogId ?? null`, `model` to `entry.model`, and `params` to `entry.params ?? []`.

**Does `EngineEntry` survive?** It survives, unchanged in its place and in its name. `EngineEntry` stays the stored shape of `engines.json` and the type every existing caller takes; `Profile` is what that entry is read as. The reason is in section 3.2: renaming the stored shape changes nothing that is stored, and can therefore be done at any later time at no cost, while the identifier and the record shape cannot. `EngineEntry` gains one field, `model` (section 3.5), and loses none.

### 3.2 Identity

This is the decision the stage exists for.

**A profile's id is the id the engine already has in `engines.json`.** `default.claude` is the id of the Claude Code profile. `default.gemini` is the id of the Human Lead's hand-added Gemini profile. A profile the Human Lead adds later gets a new id of its own, and the existing profiles keep theirs.

**What is written into a desk record from now on.** `SessionRecord.engine` keeps its name and its meaning is stated exactly: the id of the profile the session ran. For every record written before M14 that is the id of the engine, and the two are the same string, so no record changes meaning and none is rewritten.

Beside it, three optional fields are added, written at the start of a session:

```ts
/** The profile a session ran under, as it was when the session started. */
export type SessionProfile = {
  /** The profile's id. The same string as the record's `engine`. */
  id: string;
  /** The profile's name when the session started. */
  name: string;
  /** Which engine the profile runs: a catalog id, or the binary's file name (`engineNameOf`). */
  engine: string;
  /** The model the profile names. Absent when it names none. */
  model?: string;
};

export type SessionRecord = {
  id: string;
  /** The id of the profile the session ran. Before M14 the id of the engine it ran; the same string. */
  engine: string;
  attended: true;
  mode: SessionMode;
  startedAt: string;
  closedAt?: string;
  item?: IssueRef;
  issue?: IssueRef;
  unguarded?: string[];
  /** The profile the session ran. Absent on a record written before M14. */
  profile?: SessionProfile;
  /** The texts of the parameters ticked at the start, in order. Absent when none were. */
  params?: string[];
  /** What the session spent, written when it ends (section 3.6). */
  spend?: SessionSpend;
};
```

`SessionProfile.engine` names the engine. `SessionRecord.engine` holds the profile's id. They are different things with the same field name. `SessionRecord.engine` is not renamed because renaming it would mean rewriting every record already stored, which is what this stage is being done early to avoid.

`params` is here because a profile is an engine, a model **and** its parameters, and in 1.0 the parameters a session actually ran with are the ones ticked at that start, not the profile's `defaultOn` list. It is also how the model of a Space session is recoverable today, since a Space session's model is chosen with a parameter (`--model opus`) and not with `Profile.model` (section 3.5).

**What is written onto the Agents board from now on.** The issue's marker does not change. The issue's title does not change: `sessionIssueTitle` keeps `The <engine> session that started at <startedAt>`, fed as today from `SessionRecord.engine`, which is the profile's id. One line is added to the body, between the item and the write targets:

```
Profile: <name> (<id>), engine <engine>, model <model, or "the engine's default">
```

The body is rewritten on every `putSessionIssue`, so an issue of a session that is still running gains the line the next time it enters Writing. An issue of a session that has ended is never written again and keeps the body it has; nothing is removed from it, so it stays readable and means what it meant.

**Why not a new identifier.** A namespaced profile id (`profile.claude-code`, or an id that carries the engine) would have to be mapped onto every stored `default.claude` for the desk, the baseline picker and the board to keep agreeing about which session ran what. The mapping would be code that never goes away. Keeping the id makes the migration empty, and it stays correct when the Human Lead adds a second Claude profile: that profile gets its own id, and `default.claude` keeps meaning the first one.

### 3.3 Reading what is already stored

| What | After M14 |
|---|---|
| `engines.json` with no `model` and no `helperModel` (the Human Lead's file, section 2.2) | Parses to the same five entries. `parseEngineEntry` adds no field, `mergeEnginesWithCatalog` reports `changed: false`, and `loadEngines` writes nothing back. Read as profiles, `model` is absent on all five. |
| `engines.json` with `helperModel` set on an entry | `parseEngineEntry` reads `model` when present, and `helperModel` when `model` is absent, into `model`; it then writes both `model` and `helperModel` with that value (section 3.5). The merge carries `model` as it carries `helperModel`. `changed` is true once, so the file is written back once, as the M10 parameter migration writes it back once. |
| `engines.json` with a hand-added entry whose id is not a catalog id (`default.gemini`) | Unchanged. It is a profile with `engine: null` and `engineNameOf` `gemini`. `canRunGuardedSession` still refuses it for a Space session, exactly as today. |
| A `sessions.json` record written before M14 | `isSessionRecord` accepts it: `profile`, `params` and `spend` are optional. `record.engine` is the profile's id. Nothing is rewritten; the desk's store already writes back unknown and untouched records as they were read. |
| A `sessions.json` record whose `engine` names a profile that no longer exists | Read as it always was: the string is displayed, and no profile is looked up. `baseline/points.ts`, `dashboard-model.ts`, `broker.ts` and `ipc/dialogs.ts` all pass the string through and none of them resolves it against `engines.json` today. This does not change. |
| `ui/session-engine.json`, `engine-state.json` | Unchanged. Their `engineId`, `lastPicked` and `helperEngine` are profile ids as they stand. |
| A session issue written before M14 | Unchanged, and never rewritten once its session has ended. |

**No stored data is migrated by M14.** The one write-back is the `helperModel` to `model` copy inside `engines.json`, which follows rule 2 of `m10-architecture.md` 3.4 and is a no-op on the Human Lead's file because no entry has `helperModel`.

### 3.4 Roles

1.0 has three roles. No role is invented here.

| Role | What it is | Where its pointer is stored | Which profile it runs |
|---|---|---|---|
| The Space session | The guarded AI session a Space window starts (`main/space/sessions/service.ts`) | `<desk>/ui/session-engine.json`, field `engineId`, per Space | The profile of that id. When it cannot start, `engineChoice` picks the first that can, exactly as today (A.9). |
| The read-only helper | The assistant panel's engine, which the app drives one turn at a time (`main/ipc/helper.ts`, `main/helper/`) | `<userData>/projects/<hash>/engine-state.json`, field `helperEngine`, per project | The profile of that id, and its `model` (section 3.5). Unset: the first helper-capable profile, as `pickHelperEngine` decides today. |
| The v0.8 AI tab | The interactive tab of the v0.8 cockpit (`main/pty.ts`) | The same file, field `lastPicked`, per project | The profile of that id, through `EngineEntry.args` as today. M8 removes this role with the rest of v0.8; M14 changes nothing about it. |

A role points at a profile by its id and by nothing else. No role gains a stored field in M14: all three pointers already hold profile ids.

### 3.5 The model, and the read-only helper

`EngineEntry` gains `model?: string`. `helperModel` is not read after parse and is not written by anything but the parser.

```ts
export type EngineEntry = {
  id: string;
  name: string;
  binary: string;
  params?: EngineParam[];
  args?: string[];
  /** The model of this entry's profile, in the engine's own naming. Absent: the engine's default. */
  model?: string;
  /**
   * The previous name of `model`, before the profile shape. Written with the
   * same value so a build older than M14 still reads it, and read only when
   * `model` is absent. Nothing but `parseEngineEntry` touches it.
   */
  helperModel?: string;
};
```

Rules, in `parseEngineEntry` (`packages/core/src/engines/engines.ts`):

1. When `model` is a non-empty string, it is `model`. Otherwise, when `helperModel` is a non-empty string, it is `model`. Otherwise `model` is absent.
2. When `model` is set, `helperModel` is written with the same value. When it is absent, both are absent. This is the same reason `args` is derived from `params` and kept: a build older than this one shares the data folder and reads the old field.
3. The identity tuple of `engineCatalog.identity` uses `model` in place of `helperModel`.
4. `mergeEnginesWithCatalog` carries `model` from the stored entry exactly as it carries `helperModel` today (`merge.ts`, `mergedEntry`).

What reads `Profile.model` in 1.0:

- The read-only helper. `main/ipc/helper.ts` line 172 becomes `model: profileOf(engine.entry).model ?? GEMINI_HELPER_MODEL`. This is the same behaviour as today for every stored file, since `model` is read from `helperModel` when it is the only one set.
- Nothing else. **A Space session's command line does not gain `--model`.** The model of a Space session is chosen with a parameter, as it is today, and putting `Profile.model` on the command line would change how a session starts, which the stage's gate forbids. `Profile.model` is recorded on the session record so that what the profile named is known, and `SessionRecord.params` records what the session actually ran with. Closing that gap — a profile's model reaching every role — is 1.1's, and it costs nothing stored, because the field is already there.

Settings gains one text input, "Model", in the engine editor of `SettingsSheet.tsx`, beside "Binary", bound to `draft.model`. Without it the profile has a model the Human Lead cannot set, and the helper's model stays invisible. It changes no session.

### 3.6 What a session spent

```ts
/** What a session spent, written when it ends. */
export type SessionSpend = {
  /**
   * Where the numbers come from.
   * - `engine`: the engine reported them and the companion read them.
   * - `none`: the engine reported nothing this build can read. No number follows.
   */
  source: 'engine' | 'none';
  /** The cost in US dollars, when the engine reported one. */
  usd?: number;
  /** The tokens the engine reported. A field is absent when the engine did not report it. */
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** The model the engine reported it ran, when it reported one. It can differ from the profile's. */
  model?: string;
};
```

It is written into `SessionRecord.spend` by `endSession`, in the same atomic write that sets `closedAt` and puts the session in Read only. It is written on **every** close, including as `{ source: 'none' }`, so that "the engine reported nothing" and "this record is older than M14" are different states on disk.

Why on the session record and not in a file of its own: the close already writes that record, the record already carries the session's start facts, and one file means one write.

**How the number is read.** `EngineAdapter` gains an optional method:

```ts
/** What the engine reported this session spent. An adapter without one reports `{ source: 'none' }`. */
readSpend?(input: { sessionId: string; paths: SessionFilePaths }): Promise<SessionSpend>;
```

`service.ts`'s `finish` calls it before `endSession`, in the same place and the same way it already reads the refusals the before-write hook noted, and passes the result to `endSession`. A `readSpend` that throws is caught and gives `{ source: 'none' }`; a session's close is never held up by it.

**Which engine can report a cost, and which cannot.** The labels are those of `m10-architecture.md` section 2: **Observed** is seen in a run, **Checked** is read in the engine's documentation or help text, **Unverified** is neither.

| Engine | Can the companion read what a session spent | M14 |
|---|---|---|
| Claude Code | Checked: a `Stop` hook receives JSON on standard input holding `session_id` and `transcript_path`, and the transcript is JSON lines whose assistant entries carry a `usage` object. Unverified: the field names in the version in use, and whether a cost in dollars is among them. | `readSpend` reads `spend.json` from the session's folder, written by a new hook (M14.6). |
| Antigravity CLI | Unverified. Nothing in the M10 findings records a usage report, and the session runs interactively, not through `-p`. | No `readSpend`. `{ source: 'none' }`. |
| Codex CLI | Unverified. `codex exec --json` is documented to carry token counts, and a guarded session does not run `codex exec`. | No `readSpend`. `{ source: 'none' }`. |
| OpenCode | Not applicable: `guardedSessions` is `false`, so it cannot run a Space session at all. | No adapter path to reach. |

**The Claude Code reader (M14.6).** A third generated file, `spend.json`, in the session's folder beside `refusals.jsonl`, and a third Python adapter, `hooks/session-spend.py`, beside the two write adapters. It is registered as a `Stop` hook, not a `SessionEnd` hook, for one reason: `Stop` fires when the engine finishes a response, so the file is already on disk when the Human Lead kills the window or the process dies, whereas `SessionEnd` may never run. The adapter reads the hook's JSON on standard input, opens `transcript_path`, sums the `usage` numbers of the assistant entries, takes a cost in dollars when one is there, and overwrites `spend.json`. It catches everything and **always exits 0**: in Claude Code a `Stop` hook that exits 2 blocks the engine from stopping, and no session is to be held up by a measurement. Its timeout is 10 seconds.

### 3.7 What does not change

Each line is proven by an existing test that M14 does not edit. A phase that has to edit one of them has found a behaviour change and reports it.

| What does not change | Proven by |
|---|---|
| The start call: `SpaceSessions.start(engineId, params)` and the IPC argument `{ engineId, params }` | `packages/app/test/headless/space/sessions.test.ts`, unedited |
| The engine choice of A.9: which engine is offered, which is remembered, which refusal and fix are shown | `headless/space/engine-choice.test.ts`, unedited |
| The parameters, their default ticks, and the texts that reach the engine | `headless/space/engine-options.test.ts`, `component/space/engine-start-control.test.tsx`, unedited |
| The engine's command line: no argument is added or removed for any engine | `headless/space/engine-adapters.test.ts` and the three per-engine adapter tests, unedited |
| The guard: the generated settings, the two write hooks, and the `sessions.json` fields `id` and `mode` that `contracts/core/write-guard.py` reads | `core/test/space/checks.int.test.ts` and `headless/space/guards-gate.test.ts`, unedited; the check script is not edited by any phase of M14 |
| The catalog and the merge rules 1 to 4 of `m10-architecture.md` 3.4 | `core/test/space/engines.test.ts` and `headless/space/engines-catalog.test.ts`; only the cases that name `helperModel` are edited, and each is edited to assert the same value under `model` |
| The session issue's marker and title, and the Agents board's columns | `core/test/space/session-issue.int.test.ts` and `headless/space/session-board.test.ts`; only the body assertion gains the new line |
| The unguarded label, in the record, the header, the tab and the board row | `headless/space/session-header-ipc.test.ts`, unedited |

Two of these are worth stating plainly because a developer could break them without noticing. First, `contracts/core/write-guard.py` reads `sessions.json` itself, in another process; adding optional fields to a record is safe and renaming `engine` or `mode` is not, and M14 renames neither. Second, `Profile.model` reaching a Space session's command line would change how every session starts; it does not, by section 3.5.

---

## 4. Decisions, and questions for the Human Lead

### 4.1 Decisions this document takes

1. A profile's id is the id the engine already has in `engines.json`. Nothing stored is migrated.
2. `SessionRecord.engine` keeps its name and now means the profile's id, which is the value it already held.
3. `EngineEntry` survives as the stored shape; `Profile` is what it is read as. `engines.json` keeps its name and its place.
4. `helperModel` becomes `model` on the entry and on the profile, with `helperModel` written alongside for an older build, as `args` is written alongside `params`.
5. A profile's model is applied by the read-only helper and by nothing else in 1.0.
6. `spend` is written on every close, including `{ source: 'none' }`.
7. The Claude Code spend reader hangs off a `Stop` hook, not `SessionEnd`.

### 4.2 Questions

1. **Does the Agents board's issue title change?** Today it reads `The default.claude session that started at …`, which is the profile's id and not its name. **Recommendation: leave it.** Changing it changes no stored identifier but does change the text of every issue updated afterwards, and the profile's name is added to the body in any case.
2. **Does the Human Lead get a "Model" input in Settings?** **Recommendation: yes** (section 3.5). Without it a profile has a model nobody can set, and the helper's model stays invisible. It changes no session.
3. **Is the `helperModel` mirror worth keeping?** It exists so a build older than M14 sharing the data folder still finds the helper's model. **Recommendation: keep it**, for the same reason `args` is kept; it is two lines in one function and can be dropped whenever the v0.8 build is gone.
4. **Does M14 include the real-engine check of the Claude Code spend reader?** The reader is the only way the gate item "a session's close records its profile and its cost" is met with a number rather than with `{ source: 'none' }`, and it needs one real Claude Code session to confirm the transcript's fields. **Recommendation: yes**, as phase M14.6, with the finding recorded as M10.9 recorded its own; if the transcript turns out to hold nothing readable, the phase records `source: 'none'` and says so, and the shape still ships.
5. **Is `SessionRecord.params` in scope?** It records the texts of the parameters ticked at the start. It is the only way to know which model a Space session ran, since the model is a parameter today. **Recommendation: yes**; it is one optional field written in the same call that already writes `unguarded`.

---

## 5. Phases

### How to read a phase

As in `m10-architecture.md` section 5. Each phase lists its files and the exact changes. "Create" is a new file, "Edit" an existing one. Names, types and field names given here are fixed; what a phase does not fix is the developer's smallest choice under section 7 of `mvp-architecture.md`, listed under "Choices made" in the phase report.

Every phase ends with the definition of done of section 8.7 of `mvp-architecture.md`. The commands, from the repository root, with `<id>` the phase id in lower case (`m14-1`):

```
npm run verify
npm run lint
AI_LORE_CORE_TEST_OUT=.test-runs/<id>/dist-test npm test -w @ai-lore-companion/core
AI_LORE_APP_TEST_OUT=.test-runs/<id>/dist-test npm run test:headless -w @ai-lore-companion/app
npm run test:component -w @ai-lore-companion/app
npm run e2e                      # phases that change main, preload or renderer
```

An existing test whose behaviour a phase changes is edited, not deleted, and the report names it. Developer agents run with the project root as their working directory, write files only with the Write and Edit tools, and make no commit.

### Order and parallel groups

| Group | Phases | Runs after |
|---|---|---|
| 1 | M14.1 and M14.2 in parallel | — |
| 2 | M14.3 | M14.1, M14.2 |
| 3 | M14.4, M14.5 and M14.6 in parallel | M14.3 |

M14.1 and M14.2 are both core and may still run together: M14.1 is `src/engines/` and `src/space/engines/`, M14.2 is `src/space/desk/`, and they share no file, not even a barrel — M14.1 edits `space/engines/index.ts` and M14.2 edits `space/desk/index.ts`.

M14.3 may not run beside either: it is the phase that joins them, and it needs both `Profile` and `SessionProfile` to exist.

M14.4, M14.5 and M14.6 share no file with each other. M14.4 is the board, M14.5 is the helper and Settings, M14.6 is the Claude Code spend reader and the session's generated files.

Files several phases need, and the phase that owns each. A phase that does not own a file does not edit it; it names the lines it needs in its report, and the orchestrating session has the owner add them.

| File | Owner |
|---|---|
| `packages/core/src/space/engines/index.ts` | M14.1 |
| `packages/core/src/space/desk/index.ts`, `types.ts`, `guards.ts`, `lifecycle.ts`, `sessions.ts` | M14.2 |
| `packages/app/src/main/space/sessions/service.ts` | M14.3 |
| `packages/app/src/main/space/sessions/engines/types.ts` | M14.3 |
| `packages/app/src/main/space/sessions/files.ts`, `constants.ts`, `adapters.ts`, `engines/claude-code.ts` | M14.6 |
| `packages/core/src/space/project/session-issue.ts`, `packages/app/src/main/space/session-server/board.ts` | M14.4 |

---

### M14.1 — The profile in core

**Goal.** `Profile` exists, an engine entry is read as one, and `helperModel` becomes `model`.

**Files.**

- **Create** `packages/core/src/space/engines/profiles.ts`: `Profile`, `profileOf`, `entryOf`, `profileById`, `engineNameOf`, exactly as section 3.1 gives them. `entryOf` derives `args` with `defaultParamArgv(profile.params)` and leaves it out when that is empty, and omits `params` when it is empty, so that `entryOf(profileOf(e))` equals `parseEngineEntry(e)` for every entry.
- **Edit** `packages/core/src/space/engines/index.ts`: export the five names and the type.
- **Edit** `packages/core/src/engines/engines.ts`: add `model?: string` to `EngineEntry` with the comment of section 3.5; accept it in `isEngineEntry` (a string, or absent); apply rules 1 to 3 of section 3.5 in `parseEngineEntry`; replace `helperModel` with `model` in `engineCatalog.identity`.
- **Edit** `packages/core/src/space/engines/merge.ts`: in `mergedEntry`, carry `model` beside `helperModel` (`if (taken.model !== undefined) out.model = taken.model;`), and update rule 3 of the function's comment.

**Tests.** Core unit, in `packages/core/test/space/engines.test.ts` and `packages/core/test/engines.test.ts`:

- `profileOf` on a catalog entry gives `engine: 'claude-code'`; on a hand-added `gemini` entry gives `engine: null` and `engineNameOf` `gemini`; on an absolute binary `/opt/homebrew/bin/gemini` gives `engineNameOf` `gemini`.
- `entryOf(profileOf(entry))` equals `parseEngineEntry(entry)` for: a bare entry, one with parameters, one with `helperModel`, one with `model`.
- An entry with `helperModel: 'opus'` and no `model` parses to `model: 'opus'` **and** `helperModel: 'opus'`.
- An entry with `model: 'sonnet'` and `helperModel: 'opus'` parses to `model: 'sonnet'` and `helperModel: 'sonnet'`.
- An entry with neither has neither.
- `mergeEnginesWithCatalog` on the Human Lead's five-entry list (section 2.2, written out in the test) gives `changed: false`.
- `mergeEnginesWithCatalog` carries a stored `model` onto the catalog entry it merges into.

**Test tier.** Core unit.

---

### M14.2 — The session record: the profile, the parameters and the spend

**Goal.** A session record can carry the profile it ran, the parameters it ran with, and what it spent; a record written before this phase still parses and is unchanged on disk.

**Files.**

- **Edit** `packages/core/src/space/desk/types.ts`: add `SessionProfile` and `SessionSpend` of sections 3.2 and 3.6; add `profile?`, `params?` and `spend?` to `SessionRecord`; add `spend?: SessionSpend` to `SessionPatch`. This file imports nothing and must keep importing nothing: `SessionProfile.engine` is a `string`, not `EngineCatalogId`.
- **Edit** `packages/core/src/space/desk/guards.ts`: `isSessionProfile` (a JSON object with non-empty `id`, `name` and `engine`, and `model` a string or absent) and `isSessionSpend` (`source` is `'engine'` or `'none'`; `usd`, when present, a finite number that is not negative; `tokens`, when present, a JSON object whose present fields are integers that are not negative; `model`, when present, a string). Extend `isSessionRecord` with `isOptional(value.profile, isSessionProfile)`, `isOptional(value.params, isStringArray)` and `isOptional(value.spend, isSessionSpend)`. Export both new guards.
- **Edit** `packages/core/src/space/desk/sessions.ts`: `closeSession(desk, sessionId, spend?: SessionSpend)` sets `mode`, `closedAt` and, when `spend` is given, `spend`.
- **Edit** `packages/core/src/space/desk/lifecycle.ts`: add `profile?: SessionProfile` and `params?: readonly string[]` to `SessionStart`, written by `startSession` when given and when `params` is non-empty; add `EndOptions = LeaveOptions & { spend?: SessionSpend }` and give `endSession` that type, passing `options.spend` to `closeSession`. `leaveWriting` is unchanged.
- **Edit** `packages/core/src/space/desk/index.ts`: export `SessionProfile`, `SessionSpend`, `EndOptions`, `isSessionProfile`, `isSessionSpend`.

**Tests.**

- Core unit (`core/test/space/desk.test.ts`): each guard accepts a valid value and refuses each malformed one; `isSessionRecord` accepts a record with none of the three new fields and one with all three.
- Core integration (`core/test/space/desk-lifecycle.int.test.ts`): a session started with a profile and parameters has them on disk; `endSession` with a spend writes it in the same file; `endSession` without one leaves `spend` absent; a `sessions.json` written by hand in the pre-M14 shape is read, a session of it is closed, and every other record in the file is byte-identical afterwards.

**Test tier.** Core unit and core integration.

---

### M14.3 — A Space session starts from a profile and records it

**Goal.** The session service reads its engine as a profile, records it and the ticked parameters at the start, and records a spend at the close. No engine reports a spend yet.

**Files.**

- No new store and no new file: the service already receives the engine entries through `SpaceSessionParts.engines()`, and reads one as a profile with `profileOf` at the point it needs it. `packages/app/src/main/engines.ts` is not edited by this phase.
- **Edit** `packages/app/src/main/space/sessions/engines/types.ts`: add the optional `readSpend` of section 3.6 and its input type.
- **Edit** `packages/app/src/main/space/sessions/service.ts`:
  - `Live` gains `adapter: EngineAdapter`, which `start` already holds (`adapterFor(engine)`, non-null by the point `live.set` is called) and which `finish` needs to read the spend.
  - The `startSession` call gains `profile: { id: p.id, name: p.name, engine: engineNameOf(p), ...(p.model !== undefined ? { model: p.model } : {}) }` and `params: [...params]`. `params` is `start`'s own argument, the ticked texts in the order the start control gave them; `checkStartParams` has already refused any text that is not a parameter of that engine now, so no further check is needed and `checkStartParams` keeps its present signature `{ argv, unguarded }`.
  - `finish` reads the spend before `endSession`: `const spend = entry.adapter.readSpend ? await entry.adapter.readSpend({ sessionId, paths: entry.paths }).catch(() => NO_SPEND) : NO_SPEND;` with `const NO_SPEND: SessionSpend = { source: 'none' }`, and passes `{ closes, spend }` to `endSession`.
  - `StartedSession` is unchanged: no new field crosses IPC in this phase.

**Tests.** App headless, in `packages/app/test/headless/space/sessions.test.ts`:

- A started session's record carries `profile` with the profile's id, name and engine name, and `params` with the ticked texts in order.
- A session started with no ticked parameter has no `params` field.
- A closed session's record carries `spend: { source: 'none' }`.
- A started session's record still carries `engine` equal to the engine id, and `unguarded` as before.

**Test tier.** App headless. The phase changes main, so `npm run e2e` is part of its done.

---

### M14.4 — The profile on the Agents board

**Goal.** A session issue's body names the profile. Its title and its marker do not change.

**Files.**

- **Edit** `packages/core/src/space/project/session-issue.ts`: `SessionIssueContent` gains `profile?: { name: string; id: string; engine: string; model?: string }`. `formatSessionIssueBody` writes the line of section 3.2 after the `Item:` line when `profile` is given, and writes nothing when it is not. `sessionIssueTitle` is unchanged. `sessionIssueMarker` is unchanged.
- **Edit** `packages/app/src/main/space/session-server/board.ts`: in `entered`, pass `...(record.value.profile !== undefined ? { profile: record.value.profile } : {})` beside `engine: record.value.engine`.

**Tests.**

- Core unit (`core/test/space/session-issue.int.test.ts` or the unit file beside it): the body with a profile holds the line, with the model when there is one and `the engine's default` when there is not; the body without a profile is the string it is today, character for character; the title is the string it is today.
- App headless (`headless/space/session-board.test.ts`): a session whose record has a profile enters Writing and the issue in `FakeGitHub` holds the line.

**Test tier.** Core unit and app headless.

---

### M14.5 — The helper's model is the profile's model

**Goal.** The read-only helper takes its model from the profile, and the Human Lead can set it in Settings.

**Files.**

- **Edit** `packages/app/src/main/ipc/helper.ts`: line 172 becomes `model: profileOf(engine.entry).model ?? GEMINI_HELPER_MODEL`. The comment above it names `model` instead of `helperModel`. Nothing else in the file changes; `HELPER_MODEL` stays the Claude helper's constant.
- **Edit** `packages/app/src/renderer/src/components/SettingsSheet.tsx`: line 1200 carries `model` instead of `helperModel` (`if (draft.model !== undefined) entry.model = draft.model;`); add a "Model" text input to the engine editor beside "Binary", bound to `draft.model`, `data-testid="engine-draft-model"`, with the placeholder `the engine's default`. An empty input leaves `model` unset.

**Tests.**

- App headless (`headless/space/helper-engine-select.test.ts` or `headless/engines.test.ts`): an entry stored with `helperModel: 'gemini-2.5-pro'` and no `model` gives the helper that model; an entry with `model` gives that one; an entry with neither gives `GEMINI_HELPER_MODEL`.
- Component (`component/settings-sheet-spaces.test.tsx`): the existing test "helperModel survives an edit that only changes the engine's name" is edited to assert `model` and kept; one new test types a model into the input and asserts it is saved on the entry.

**Test tier.** App headless and component. The phase changes the renderer, so `npm run e2e` is part of its done.

---

### M14.6 — What a Claude Code session spent

**Goal.** A Claude Code session's record carries what the engine reported it spent, or `{ source: 'none' }` when it reported nothing.

**Files.**

- **Edit** `packages/app/src/main/space/sessions/constants.ts`: `SESSION_FILES.spend = 'spend.json'` and `SESSION_FILES.spendHook = 'hooks/session-spend.py'`; `SPEND_HOOK_TIMEOUTS = { adapterSeconds: 8, hookSeconds: 10 }`.
- **Edit** `packages/app/src/main/space/sessions/adapters.ts`: add `SPEND_ADAPTER`, the Python source of the hook, beside `PRE_WRITE_ADAPTER` and `POST_WRITE_ADAPTER`. It reads the hook's JSON on standard input, takes `transcript_path`, reads that file as JSON lines, sums the `usage` numbers of the assistant entries into `input`, `output`, `cacheRead` and `cacheWrite`, takes a cost in dollars when one is present, writes `{ "source": "engine", … }` to the path given by `--out`, and **exits 0 whatever happens**, including when the transcript cannot be read.
- **Edit** `packages/app/src/main/space/sessions/files.ts`: `SessionFilePaths` gains `spend` and `spendHook`; `writeSessionFiles` writes the third adapter; `buildSessionSettings` registers it as a `Stop` hook with `SPEND_HOOK_TIMEOUTS.hookSeconds`; add `readSessionSpend(paths): Promise<SessionSpend>`, which reads `spend.json`, checks it with core's `isSessionSpend`, and gives `{ source: 'none' }` for a missing, unreadable or malformed file.
- **Edit** `packages/app/src/main/space/sessions/engines/claude-code.ts`: `readSpend: (input) => readSessionSpend(input.paths)`.

**Tests.** App headless:

- `headless/space/engine-adapters.test.ts` or a new `headless/space/session-spend.test.ts`: `buildSessionSettings` holds one `Stop` hook with the timeout; `readSessionSpend` on a well-formed file gives the numbers, on a missing file gives `{ source: 'none' }`, on a file that is not JSON gives `{ source: 'none' }`, and on a file whose `usd` is a string gives `{ source: 'none' }`; the Python adapter, run as a child process with a fixture hook input and a fixture transcript, writes the expected `spend.json` and exits 0; the same adapter with a `transcript_path` that does not exist exits 0 and writes nothing.
- `headless/space/sessions.test.ts`: a Claude Code session whose folder holds a `spend.json` closes with that spend on its record.

**The real-engine check (question 4 of section 4.2).** One guarded Claude Code session in a scratch Space under the session's scratchpad, never in this repository and never in a real Space. What is checked: that the `Stop` hook runs; that its standard input holds `transcript_path`; which usage fields the transcript actually has; whether a cost in dollars is among them. The finding is written into `packages/docs/m14-engine-findings.md`, with the run named, as `m10-engine-findings.md` records its own. If the transcript holds nothing readable, `readSpend` stays in place, every Claude Code session records `{ source: 'none' }`, and the phase report says so.

**Test tier.** App headless, plus one manual real-engine check.
