---
type: verb
name: mirror-review
pillar: producing
mode: writing
invoked_by:
  - human-lead
---

# mirror-review

This verb brings a mirror up to date with its payload. A mirror describes one payload: its stored skeleton is a listing that a script generates from the payload, and its prose says what the payload looks like and where things go. A mirror is out of date when the skeleton that the script generates now differs from the stored one. The verb generates the skeleton again, compares the two, proposes a change to the prose for each difference, and, after the Human Lead has confirmed the changes, writes the mirror with its new skeleton.

## When it is invoked

The Human Lead invokes it on a mirror that is out of date, from the companion or by asking a session. The verb session-orient says at the start of a session which mirrors are out of date.

It is not run while work is in progress. A mirror is reviewed after the work is merged, against what the payload then contains. A branch that is not merged does not count. The process work and the verb session-close do not run it.

## What it reads

- The mirror, `lore/mirrors/<payload>.md`: its frontmatter, with `generator` and `skeleton`, and its prose.
- `lore/space.md`, for the payload's kind and its folder.
- The payload. For a repository, the default branch. For a publish area, the folder.
- `lore/mirrors/generators/index.md`, for how the generators are run and what their lines mean.

## What it writes and the mode it needs

It writes one file, the mirror, which is in the Lore. The session must therefore be in Writing with a claim that covers the Lore. It asks for Writing only when there is something to write: steps 1 to 6 run in Read only.

It writes nothing to the payload.

## Steps

1. Read the mirror and find its payload in `lore/space.md`.
2. Generate the skeleton again, with the generator that the mirror's frontmatter names. For a repository, run `python3 lore/mirrors/generators/repository-skeleton.py repos/<name>`. It lists the default branch as the desk last fetched it, so run `git fetch` in the repository first. For a publish area, run `python3 lore/mirrors/generators/folder-skeleton.py <folder>`. It lists the folder as it is on disk.
3. Compare the lines that the generator printed with the items of `skeleton` in the mirror. If they are the same, the mirror is current: say so, write nothing, and stop.
4. List the differences. Each is an addition, a removal or a rename. A removal and an addition with the same content at another path are a rename.
5. For each difference, read what the payload now holds there, and propose a change to the mirror's prose: a sentence to add for an addition that the prose should describe, a sentence to remove or change for a removal, a path to change for a rename. When a difference needs no change to the prose, say so. Show the Human Lead the differences and the proposed changes together.
6. The Human Lead confirms the changes, edits them or rejects some of them. Only what they confirmed is written.
7. Enter Writing with the Lore as the target, as the next section says.
8. Write the mirror: the prose with the confirmed changes, and `skeleton` with the lines that the generator printed in step 2, one list item per line. The new skeleton is written whole, also when the Human Lead rejected a change to the prose, because the skeleton is what the script generates.
9. The AI engine runs the check of the contract lore-integrity after the write. If the check reports a failure, fix it before leaving Writing.
10. Commit the changed mirror in the Space repository, and push the commit, so that the other desks of the Space get the change.
11. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
12. Tell the Human Lead that the mirror is current, and what changed in it.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 8. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says which mirror is written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing to the Lore. The mirror stays out of date.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. After a write to the Lore, its check requires that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children.

No core contract guards the Producing pillar, because what a payload looks like is the Space's own. The Space's own contracts on a payload are in `lore/contracts/`.

## What it refuses

- Reviewing a mirror against a branch that is not merged, or against changes that are not committed.
- Writing a change to the prose that the Human Lead did not confirm.
- Writing a skeleton that the generator did not print.
- Any write to the payload. The verb writes the mirror and not the payload.
- Any write to the Lore before the Human Lead has confirmed the claim on it.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document gives the steps of this verb. Asking for Writing after the Human Lead has confirmed the changes, and not before, is this card's order. It follows from the statement that Writing begins when the AI Agent is about to write.
- `git fetch` in step 2 is this card's. The generator for repositories reads the default branch as the desk last fetched it and does not fetch.
- Step 4's way of telling a rename from a removal and an addition is this card's.
- Writing the whole new skeleton when the Human Lead rejected a change to the prose is this card's. It follows from the statement that a mirror is current when its stored skeleton matches the generated one.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 10 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 11 returns the session to the mode it was in before the verb.
- The focus of the first build leaves mirror review in the companion's screens out of the first build. The verb is invoked by asking a session.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
