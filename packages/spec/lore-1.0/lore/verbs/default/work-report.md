---
type: verb
name: work-report
pillar: working
mode: read-only
invoked_by:
  - work
  - human-lead
---

# work-report

This verb reports a piece of work against its acceptance criteria. For each criterion it states one of three things: met, with the evidence; not met; or changed, with the reason. It writes the report to the plan. The report is what lets the Human Lead check that the work is finished, because every criterion that is stated as met names something that they can look at.

The verb reads the Lore for where this Space keeps acceptance criteria and what counts as evidence, and it does not assume the default layout. With the default layout, the piece of work is an item, its criteria are in the body of the item's issue, the report is the last comment on that issue, and a changed criterion is also noted in a comment on the item's focus.

## When it is invoked

The process work runs it in its step report. The Human Lead also invokes it on any piece of work that is in progress, to see where it stands against its criteria.

## What it reads

- The Lore, for where acceptance criteria are kept, what counts as evidence, and where a report goes. With the default set, the entries in `lore/corpus/default/` describe the layout, and the corpus entries acceptance criteria and evidence say the rest.
- The piece of work on GitHub, read with `gh`: its text and its criteria.
- The agreed spec of its unit of work, when there is one.
- The work itself: the branch, the tests and what they print, the files that were written.

## What it writes and the mode it needs

It writes only to the plan on GitHub, with `gh`: the report, and a note on the spec's unit of work when a criterion changed. A session in Read only may update the GitHub Project, so the verb runs in Read only. It does not ask for Writing. A session that is in Writing when the verb is invoked stays in Writing.

## Steps

1. Read in the Lore where this Space keeps acceptance criteria, what counts as evidence, and where a report goes.
2. Read the piece of work and its criteria. If it has no criteria, write a report of what was done, and continue with step 6.
3. Take the criteria one at a time. For each, state one of these three:
   - Met, with the evidence. Evidence is something that the Human Lead can check: the name of a test, what a command printed, a screenshot, or the Human Lead's own reading of the result. Run the test or the command now, and do not report from memory.
   - Not met, with what is missing.
   - Changed, with the reason. A criterion is changed when the work showed that what the spec asks for is different from what the criterion says.
4. For a criterion whose evidence is the Human Lead's confirmation or reading, show them the result and ask in the conversation. Write their answer in the report as the evidence for that criterion. This question is not a gate. In an unattended session there is nobody to ask: the product document says that the session then moves to Blocked with the evidence attached.
5. When a criterion is changed and the piece of work has a spec, write a note on the spec's unit of work that names the criterion and gives the reason. With the default layout, the note is a comment on the focus. A changed criterion means that the spec is published again. This verb does not do that: in the process work it is a gate, and the process asks it.
6. Write the report to the plan, where the layout says a report goes. With the default layout, write it with `gh` as a comment on the item's issue. Say to the Human Lead that the comment is being written, and write it.
7. If GitHub cannot be reached, the report is not written and nothing queues it. Say so to the Human Lead, and keep the text of the report in `workbench/scratch/`.
8. Tell the Human Lead, or the process, the result: which criteria are met, which are not met, and which are changed. A criterion that is not met keeps the piece of work open.

This verb does not move the status of the piece of work, does not open a pull request and does not leave Writing. The process work does these in its last step.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. The verb writes to GitHub and to the Workbench only, and the check allows both in either mode.
- spec-before-breakdown, `lore/contracts/core/spec-before-breakdown.md`. Its rule says that the criteria of a piece of work are drawn from the agreed spec. That is why a changed criterion is reported on the spec's unit of work, and why it is not changed only on the piece of work.

## What it refuses

- Stating a criterion as met without evidence.
- Stating as met a criterion that the Human Lead confirms, before the Human Lead has answered.
- Changing a criterion on the plan or in the spec. The verb reports the change and the reason.
- Closing the piece of work or moving its status.
- Any write to the Lore or to a payload.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document lists the kinds of evidence. The instruction in step 3 to run the test or the command now is this card's. It follows from the statement that a finished piece of work is based on something that the Human Lead can check.
- The product document calls a criterion that the Human Lead confirms a gate. The Human Lead decided on 2026-09-18 that the process work has two gates, entering Writing and republishing a changed spec. Step 4 follows the decision and does not treat the question as a gate. Asking it in the conversation is this card's.
- The sentence in step 3 that says when a criterion is changed is this card's. The product document uses the word and does not define it.
- The focus of the first build says that a plan update that cannot reach GitHub fails, that the session says so, and that there is no queue. Step 7 follows that. Keeping the text in `workbench/scratch/` is this card's.
