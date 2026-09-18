---
type: process
name: work
pillar: working
steps:
  - read-item
  - claim
  - work
  - report
  - leave-writing
gates:
  - claim
  - report
unattended: true
---

# work

## What it is for

This process takes one item from its acceptance criteria to a pull request. An item is one piece of work on the plan. It can be a piece of a unit of work that has a spec, or it can stand alone. The session names what it will write before it writes, works on a branch created from the item's issue, reports each criterion with its evidence, opens a pull request, and returns to Read only.

Work that is on no item runs no process. The session claims its write targets, writes and closes, and it opens a pull request only if the Human Lead asks for one.

The process has five steps: read-item, claim, work, report and leave-writing. The steps claim and report are its two gates. No step of this process runs another process.

## When the Human Lead starts it

The Human Lead starts work by its name, in a session, on one item that they want built. They start it on each item in the order that the dependencies between the items allow. With the default layout, which the entries in `lore/corpus/default/` describe, the item is a sub-issue of a focus whose Stage field has the value Build, or a standalone item.

The session is in Read only when the process starts. It enters Writing at the step claim.

## The steps

### read-item

This step uses no verb.

The session reads the item: its body, its acceptance criteria and its dependencies. When the item belongs to a unit of work that has an agreed spec, the session also reads the spec. If the item is blocked by another item that is not done, the process stops and the session says so.

### claim

This step uses no verb. It is the first gate of the process.

The session names its write targets. A repository is one target, and the target names the branch that the session will write on. The branch is the item branch. If the item's issue already has a branch, because an earlier session started the item, the session names that branch. If it has none, the session creates the branch from the item's issue with the command `gh issue develop --branch-repo`. The option is needed because the issue is in the Space repository and the branch is in the payload's repository. A publish area is a target if the item publishes a document. The Lore is a target if the item changes it.

The session then asks to enter Writing, as the section "The gates" below says. When the Human Lead confirms, the session is in Writing and holds the targets.

The session then reads the column Writing of the Agents board again, with `gh`. If an issue that was created earlier claims one of the same targets, the session calls the tool `leave_writing`, tells the Human Lead which session holds the target, and the process stops.

Before its first write to a repository, the session fetches the item branch and checks it out in the repository's folder under `repos/`. The check of the contract write-guard refuses a write to the repository while another branch is checked out.

### work

This step uses no verb.

The session reads the mirror of each payload before it writes to that payload. It edits on the branch and commits as the work progresses. It comments its progress on the item's issue. It writes nothing in `workbench/journal/` during this step: the session's journal entry is written once, by the verb session-close, when the session closes. Notes that the session wants to keep for that entry go in `workbench/scratch/`. The AI engine runs the contract checks on each write. Nothing inside this step asks the Human Lead.

### report

This step uses the verb work-report. It is the second gate of the process, and the gate is asked only in the case described here.

The session runs work-report. For each criterion of the item, the verb states one of three things: met, with its evidence; not met; or changed, with the reason. It writes the report to the plan where the layout says a report goes. With the default layout, the report is the last comment on the item's issue. An item that has no criteria gets a report of what was done.

A criterion that is not met keeps the item open. The session returns to the step work, or it goes on to the step leave-writing when the Human Lead tells it to stop.

When the item has a spec and a criterion is changed, the spec is republished, and republishing is the gate. The session asks the gate, as the section "The gates" below says. After a yes, the session changes the spec's file in its publish area, written as the mirror of that publish area says, and comments on the spec's unit of work that the spec was republished and why. The publish area must be one of the session's write targets. If it is not, the session asks for it through the entering-Writing dialog before it writes.

A criterion whose evidence is the Human Lead's confirmation or reading is not a gate of this process. The verb work-report shows the Human Lead the result and asks in the conversation, and their answer is the evidence in the report.

### leave-writing

This step uses no verb.

The session moves the item's status on the plan. With the default layout, an item whose criteria are all reported as met moves to Done in the Status column, and an item with a criterion that is not met stays open. The session pushes the branch and opens a pull request for it, without asking. It does not merge the pull request. Merging is the Human Lead's act on GitHub.

The session then returns to Read only by calling the companion's tool `leave_writing`. The companion releases the session's targets.

## The gates

The Human Lead answers both gates. The session never answers a gate for them, and it asks through the companion and not in the conversation. The companion writes each answer to the desk's records, which are kept outside the Space's folder. A session cannot write those records.

### Entering Writing, at the step claim

The session calls the companion's tool `request_writing` with the targets, the number of the item and the reason. The tool returns a ticket at once, and the companion shows the entering-Writing dialog to the Human Lead. The dialog names the targets and shows who holds each one now. A target that another session holds cannot be chosen. The session then calls the tool `await_answer` with the ticket. While the tool returns the status pending, the session calls it again.

- When the Human Lead confirms, the companion writes the claim to the desk's records, puts the session's issue in the column Writing of the Agents board, creating the issue if the session has none, and returns the claims to the session. The check of the contract write-guard reads the claim from the desk's records from then on.
- When a target is held, or the Human Lead declines, the session stays in Read only. The process stops, and the session says why.

### Republishing a changed spec, at the step report

The session calls the companion's tool `request_gate` with the process `work`, the step `report`, the question whether the spec is republished with the changed criterion, and what the answer bears on: the criterion before and after the change, and the evidence. It waits for the answer with `await_answer`, as at the first gate.

The dialog has three answers: yes, no, and take over. The companion writes the answer to the desk's records with the process, the step and the question, and returns it to the session.

- When the answer is yes, the session republishes the spec, as the step report says.
- When the answer is no, the spec stays as it is. The criterion as the spec states it is then not met, so the item stays open, and the session tells the Human Lead so.
- When the answer is take over, the Human Lead takes the item over. The session stops the process and goes to the step leave-writing only when the Human Lead asks it to.

## When it runs unattended

The frontmatter has `unattended: true`. The items that the Human Lead tagged run unattended. The Human Lead tags an item from the companion, which records the tag on the desk, so a session cannot tag its own item.

In an unattended session, the first gate is met by the tag that the Human Lead placed on the item. At the second gate, and at a criterion that the Human Lead confirms, the session does not wait. It records on its issue what it would have asked, moves to Blocked on the Agents board, keeps its write targets and stops writing. The Human Lead answers in the companion, and the companion resumes the session or starts a new one from its handover.

## What it leaves behind

- The commits on the item's branch, and a pull request for the branch that is open and not merged.
- The report on the plan, with the evidence for each criterion. With the default layout, it is the last comment on the item's issue.
- The item's status on the plan. With the default layout, an item whose criteria are all met is Done.
- When a criterion changed and the Human Lead said yes: the republished spec in its publish area, and a comment on the spec's unit of work.
- The claim and the Human Lead's answers, in the desk's records. After the step leave-writing the session holds no target.
- Nothing in the journal yet. The verb session-close writes the session's journal entry when the session closes, and the entry ends with the handover. When the work takes more than one session, the next session reads that handover and continues the item.

The process does not move the unit of work to another stage. With the default layout, when every item of a focus is Done, the Human Lead moves the focus to Review and then to Done, in GitHub.

## Choices recorded here

The product document of AI-Lore 1.0 gives the five steps, the two gates and the verb. The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The names of the tools `request_writing`, `request_gate`, `await_answer` and `leave_writing` are taken from a proposal in the architecture document of the first build. The Human Lead has not yet accepted that proposal.
- The key `gates` lists steps, and the second gate is asked only when a criterion of an item that has a spec is changed. This card lists the step report as a gate and says in its prose when the gate is asked. It does not add a sixth step for republishing.
- The product document says that the session runs `gh issue develop --branch-repo`. The architecture document of the first build has the companion create the branch when the Human Lead confirms the dialog. This card follows the product document, and the Human Lead is asked to settle which of the two creates the branch. Taking the branch that the issue already has, and checking the branch out before the first write, are this card's.
- The product document has the session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. This card follows the product document.
- The product document says in the step work that the session journals in the Workbench, and it says elsewhere that a session adds one journal entry when it closes. The check of the contract journal-append-forward, as it was written for the first build, refuses a write to any journal entry that exists. This card therefore writes nothing in the journal during the step work and leaves the entry to session-close. Keeping notes in `workbench/scratch/` until then is this card's.
- The product document names no verb for republishing a spec. This card has the session change the spec's file in its publish area and comment on the spec's unit of work, and has it ask for the publish area if it does not hold it.
- What the session does after a criterion is not met, after the answer no, and after the answer take over is this card's.
- The product document says that work has two gates, and it also calls a criterion that the Human Lead confirms a gate. The Human Lead decided on 2026-09-18 that the gates of work are entering Writing and republishing a changed spec. This card follows the decision: such a criterion is not a gate, and it is asked in the conversation. Asking it in the conversation and not in a dialog of the companion is this card's.
- The session pushes the branch before it opens the pull request. The product document does not mention the push.
