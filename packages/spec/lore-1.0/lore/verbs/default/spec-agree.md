---
type: verb
name: spec-agree
pillar: specifying
mode: writing
invoked_by:
  - specify
---

# spec-agree

This verb publishes a spec that the Human Lead has agreed. It takes the draft from the Workbench, writes it as a file in a publish area, removes the draft, and links the published spec from its unit of work on the plan. From then on the published file is the reference: the plan is derived from it and finished work is checked against it.

## When it is invoked

The process specify runs it in its step agree, after the Human Lead has answered yes at the gate of that process. At the gate the Human Lead declares the draft agreed and names the publish area. The verb asks neither question again.

It is not the verb for writing a spec, which is spec-draft.

## What it reads

- The draft, in `workbench/drafts/`.
- `lore/space.md`, for the Space's publish areas.
- The mirror of the publish area that the Human Lead named, for where an agreed spec goes in it and how its files are written. With the default set this is `lore/mirrors/publish.md`, and an agreed spec is one file in `publish/specs/` with one line in `publish/specs/index.md`.
- The Lore, for how an agreed spec is linked to its unit of work on the plan. With the default layout, the unit of work is a focus issue and the link is a comment on it.

## What it writes and the mode it needs

It writes the spec's file in the publish area, and the line for it in the index that the mirror names. A publish area is a payload, so the session must be in Writing with a claim that covers that publish area.

It also removes the draft from the Workbench, and it writes the link on the plan with `gh`. Neither of these two needs Writing.

## Steps

1. Check what the process has given: the path of the draft, the Human Lead's yes at the gate, the name of the publish area, and the unit of work when there is one. If the yes or the publish area is missing, stop and say so. The verb does not ask for them.
2. Read the mirror of the publish area. If a file with the spec's name already exists where the mirror says an agreed spec goes, stop and tell the Human Lead. Go on only when the Human Lead says that this is a changed spec that is published again.
3. Enter Writing with the publish area as the target, as the next section says.
4. Write the spec as a file in the publish area, where and how the mirror says, with the text of the draft. Add its line to the index that the mirror names. With the default set, the file is `publish/specs/<spec>.md` and the line is in `publish/specs/index.md`.
5. When the publish area is inside the Space's folder, commit the new file and the changed index in the Space repository and push the commit. The link of step 7 points at the file on GitHub, and the other desks of the Space read the spec from there.
6. Remove the draft from `workbench/drafts/`.
7. Link the published spec from its unit of work, as the Lore says a spec is linked. With the default layout, write a comment on the focus issue with `gh` that gives the address of the published file. If GitHub cannot be reached, the link is not written and nothing queues it. Tell the Human Lead that the link is still to be written.
8. Call the tool `leave_writing` to return to Read only.
9. Tell the process that the spec is published and linked, and give the path of the published file.

This verb does not move the unit of work to its next stage. The process specify makes that move after this verb has ended.

## Entering Writing

If the session already has a claim that covers the publish area, continue with step 4. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the publish area, written `{ "kind": "publish-area", "name": "<name>" }` with the name that the publish area has in `lore/space.md`. Give `item` with the number of the unit of work's issue when there is one. Give `reason` with one sentence that says which spec is published. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the publish area, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, publish nothing, and leave the draft where it is.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and publish nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to a payload from a session in Read only, and a write outside the claimed targets from a session in Writing.
- spec-before-breakdown, `lore/contracts/core/spec-before-breakdown.md`. Its rule is that a unit of work that has a spec has no breakdown until the spec is agreed. The published file and the link that this verb writes are what show that the spec is agreed.
- The mirror of the publish area. A payload is written as its mirror says.

## What it refuses

- Publishing a draft that the Human Lead has not declared agreed.
- Publishing when no publish area has been named.
- Replacing a published spec of the same name without the Human Lead saying that the spec is published again.
- Changing the text of the draft while publishing it. What is published is what the Human Lead agreed.
- Moving the unit of work to its next stage.
- Any write to the publish area before the Human Lead has confirmed the claim on it.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document describes the gate of specify as one dialog that is also the confirmation to enter Writing on the publish area. The focus of the first build names two dialogs of the companion, the entering-Writing dialog, which records the claim, and the gate dialog, which records the answer, and the companion's tools follow it. This card follows the focus: the process asks the gate, and this verb asks for Writing when the session does not yet have the claim. The Human Lead is asked whether the two dialogs should become one.
- The product document does not say which step commits a published spec. Step 5 follows from two of its statements: that the default publish area is versioned with the Space repository, and that the spec is linked from its unit of work.
- The product document does not name a verb for publishing a changed spec again. Step 2 stops when the file exists and leaves the decision to the Human Lead.
- The focus of the first build says that a plan update that cannot reach GitHub fails, that the session says so, and that there is no queue. Step 7 follows that, and not the product document, which says that such updates are queued.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
