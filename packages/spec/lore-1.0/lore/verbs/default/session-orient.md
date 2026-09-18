---
type: verb
name: session-orient
pillar: working
mode: read-only
invoked_by:
  - ai-session
---

# session-orient

This verb is what a session does first. The session reads how the Space works, where the work stands, who is writing what, and what the last session left in progress. It ends with a statement of these things to the Human Lead, and then it waits. It writes nothing.

## When it is invoked

The session runs it on itself when it starts, after it has read `ai_readme.md`. The Human Lead does not invoke it. The Human Lead may point the session at a unit of work when they start it, and the verb then reads what concerns that unit of work.

## What it reads

In this order, and indexes before content:

- `ai_readme.md`, then `lore/index.md` and the index of each part of the Lore, with the indexes of the folders `core/` and `default/` below them. From the indexes the session knows which verbs, processes, corpus entries, contracts and mirrors exist. It opens a verb when the verb is invoked, a process when it is run, and a corpus entry when its word comes up.
- The contracts: each card in `lore/contracts/`, for its rule and for whether it has a check or only a rule.
- `lore/space.md`, for the Space's repositories and publish areas.
- Every mirror in `lore/mirrors/`, and whether each is out of date.
- The plan on the Space's GitHub Project, as the Lore says it is laid out, read with `gh`. With the default layout, which the entries in `lore/corpus/default/` describe: the focuses with their Stage, and the items of the focus that the session was pointed at.
- The Agents board: the sessions that are in Writing or Blocked, and their write targets.
- `workbench/drafts/`, for the drafts in progress.
- The last handover in `workbench/journal/`: the one for the unit of work that the session was pointed at, or the last one of the desk when it was pointed at none.

## What it writes and the mode it needs

It writes nothing. It runs in Read only, and the session stays in Read only when it ends. It creates no issue: the session's issue on the Agents board is created when the session first enters Writing.

## Steps

1. Read the Lore's indexes, the contracts and `lore/space.md`, as listed above.
2. Check which of the companion's tools the session has. There are four: `request_writing`, which asks the Human Lead for the entering-Writing dialog; `request_gate`, which asks them the question of a gate; `await_answer`, which waits for their answer to either; and `leave_writing`, which returns the session to Read only. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion. It cannot enter Writing, so it stays in Read only until it closes. Orienting does not call `request_writing`, `request_gate` or `leave_writing`.
3. Read every mirror. For each, find out whether it is out of date: run the generator that the mirror's frontmatter names, on the payload, and compare the lines that it prints with the mirror's stored `skeleton`. For a repository the generator lists the default branch, and for a publish area it lists the folder. When the lines differ, the mirror is out of date. Nothing is written, and the result is stored nowhere.
4. Read the plan and the Agents board with `gh`. If GitHub cannot be reached, say so in the statement of step 7 and go on with the rest.
5. Read the names of the drafts in `workbench/drafts/`, and which unit of work each belongs to.
6. Read the last handover, as listed above. The verb session-close names an entry's file with the date, the time, a few words and the session's id at the end, as in `2026-09-18-1430-verb-cards-<session id>.md`, so the last entry is the file whose name sorts last. Read the names in `workbench/journal/` first, and open only the entry that is needed. A handover has three parts: what was done, what is in progress, and what the next session should do.
7. State to the Human Lead, briefly:
   - where the work stands: the unit of work that the session was pointed at and its stage, or the state of the plan when it was pointed at none;
   - who is writing what: the sessions in Writing or Blocked and their write targets;
   - which mirrors are out of date;
   - what the Workbench holds in progress: the drafts, and what the last handover says the next session should do;
   - that the session is in Read only, and whether it has the companion's tools.
8. Wait for what the Human Lead asks.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. A session in Read only changes no payload and nothing in the Lore. Its check refuses such a write.
- journal-append-forward, `lore/contracts/core/journal-append-forward.md`. The verb reads the journal and does not change it.

## What it refuses

- Any write, to any place.
- Entering Writing. A session enters Writing when it is about to write, and not when it orients.
- Creating the session's issue on the Agents board.
- Reading every file of the Lore. It reads indexes, the contracts and the mirrors, and leaves the rest until it is needed, because everything that a session reads uses part of its working memory.
- Stating something about the plan or the board that it has not read. When GitHub could not be reached, it says so.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document lists what this verb reads and what its closing statement holds. The order of the steps is this card's.
- Step 2 is this card's. The architecture document of the first build says that the guards hold only for a session that the companion starts, and it names the four tools. The names are a proposal there that the Human Lead has not yet accepted. The last point of the statement in step 7 follows from step 2.
- Going on when GitHub cannot be reached follows the focus of the first build, which says that a session says so when a plan update fails.
