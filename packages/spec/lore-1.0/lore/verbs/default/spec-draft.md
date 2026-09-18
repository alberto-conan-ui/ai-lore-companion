---
type: verb
name: spec-draft
pillar: specifying
mode: read-only
invoked_by:
  - human-lead
  - specify
---

# spec-draft

This verb starts a spec or continues one. A spec is a document that says what is wanted, and the Human Lead agrees it before the work that it describes is built. Until it is agreed it is a draft. The draft is a file in `workbench/drafts/`, and the session edits it as the conversation with the Human Lead goes on. The draft stays in the Workbench between sessions, so a spec can take one session or several.

## When it is invoked

The Human Lead invokes it to start a spec or to continue one. The process specify runs it in its step draft.

It is not the verb that makes a spec agreed. Agreeing a spec is an explicit act of the Human Lead, and the verb spec-agree publishes the agreed spec.

## What it reads

- The Lore, for what a spec in this Space contains and how it is written. With the default set this is the mirror of the default publish area, `lore/mirrors/publish.md`.
- `workbench/drafts/`, for a draft of this spec that an earlier session left.
- The corpus, for the words that the spec uses. Read `lore/corpus/index.md` and the indexes below it, and open an entry when its word comes up.
- The mirror of each payload that the spec concerns, in `lore/mirrors/`.
- The items of the plan that the Human Lead points at, read from GitHub with `gh`.

## What it writes and the mode it needs

It writes only the draft, in `workbench/drafts/`. The Workbench is always writable, so the verb runs in Read only. It does not ask for Writing, and it calls none of the companion's tools.

## Steps

1. Find out which spec this is. When the Human Lead or the process names a unit of work, the draft belongs to that unit of work. Look in `workbench/drafts/` for a draft of it. If there is one, read it and continue it. If there is none, start a new file there.
2. Read in the Lore how a spec is written in this Space. With the default set, the mirror `lore/mirrors/publish.md` gives four rules for every sentence of a spec: it is written in literal statements, it has no metaphor, it has no sentence written for effect, and it has no detail that the Human Lead did not give. The mirror also says which sections a spec has.
3. Read what the spec concerns: the corpus entries for its words, the mirrors of the payloads it concerns, and the items of the plan that the Human Lead points at.
4. Write the draft with the Human Lead. Edit the file as the conversation goes on, so that the file always holds what has been said so far. When the draft needs a detail that the Human Lead has not given, ask for it and do not fill it in.
5. When a draft belongs to a unit of work, say so at the top of the draft, with the address of the unit of work on GitHub, so that a later session finds the draft from the unit of work.
6. When the Human Lead stops for now, tell them the path of the draft and which questions are still open. The draft stays in `workbench/drafts/`.
7. When the Human Lead says that the document is ready, say that the draft is ready to be agreed. In the process specify, the next step is the gate at which the Human Lead declares it agreed. The verb does not declare it agreed.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Its check allows every write under `workbench/` and refuses a write to the Lore or to a payload from a session in Read only.
- spec-before-breakdown, `lore/contracts/core/spec-before-breakdown.md`. Its rule is that a unit of work that has a spec has no breakdown until the spec is agreed. A draft is not an agreed spec, so no breakdown is made from it.

## What it refuses

- Writing the draft, or any part of it, into a publish area, the Lore or a repository.
- Declaring the draft agreed. Only the Human Lead does that.
- Adding detail that the Human Lead did not give.
- Breaking the unit of work down from the draft.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that a draft belongs to a unit of work and does not say how the draft records it. Step 5 is the smallest way that lets a later session find the draft.
- The product document does not say how a draft's file is named. This card leaves the name to the session and the Human Lead.
- `invoked_by` names the Human Lead and the process specify, because the step draft of that process runs this verb.
