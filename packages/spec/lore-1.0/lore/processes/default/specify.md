---
type: process
name: specify
pillar: specifying
steps:
  - open
  - draft
  - confirm
  - agree
gates:
  - confirm
unattended: true
---

# specify

## What it is for

This process takes an idea to an agreed spec. A spec is a document that says what is wanted. The Human Lead agrees it before the work that it describes is built. The process ends when the spec is published as a file in a publish area and is linked from its unit of work on the plan.

A spec is optional. The Human Lead can ask a session for work that has no spec, and the session does that work. This process is for work that the Human Lead wants written down and agreed first.

The process has four steps: open, draft, confirm and agree. The step confirm is its one gate. No step of this process runs another process.

## When the Human Lead starts it

The Human Lead starts specify by its name, in a session, in one of two cases. In the first case they have an idea and want it written as a spec. In the second case an earlier session left a draft in the Workbench and they want to continue it. They say what the unit of work is about, or they point at a unit of work that is already on the plan.

The session can be in Read only when the process starts. The steps open, draft and confirm write only to the Workbench and to the plan on GitHub, and a session in Read only may write to both. The session enters Writing in the step agree.

## The steps

### open

This step uses no verb.

The session reads the Lore for how the plan is laid out in this Space. It then creates the unit of work on the plan from what the Human Lead said it is about, or it takes the unit of work that the Human Lead pointed at.

With the default layout, which the entries in `lore/corpus/default/` describe, the unit of work is a focus. A focus is a parent issue in the Space's GitHub Project. It has a label that says its kind, for example a feature, a document or an investigation, and its Stage field has the value Spec.

When the session later has an issue of its own on the Agents board, that issue names this unit of work.

### draft

This step uses the verb spec-draft.

The session runs spec-draft and continues it until the Human Lead says that the document is ready. The draft is a file in `workbench/drafts/`. It stays there between sessions, so this step takes one session or several. A later session continues the same draft at this step.

### confirm

This step uses no verb. It is the gate of the process.

The session asks the Human Lead one question with two parts. The first part is whether the draft is agreed. The second part is whether the publish area that the session names is where the spec is published. The session names the publish area `publish`, whose folder `specs/` holds the agreed specs, unless the Human Lead has named another publish area.

The section "The gate" below says how the question is asked and what each answer does.

### agree

This step uses the verb spec-agree. It runs only after the Human Lead has answered yes at the step confirm.

The session runs spec-agree. The verb asks the companion for the entering-Writing dialog with the publish area as its write target, and the Human Lead confirms the claim there. The verb then publishes the spec in the publish area, removes the draft from the Workbench, links the published spec from the unit of work, and leaves Writing. The verb does not ask again whether the draft is agreed, because the Human Lead answered that at the step confirm.

The session then moves the unit of work to its next stage on the plan. With the default layout, it sets the Stage field of the focus to Plan. The core contract stage-gate says that a unit of work moves from one stage to the next only with the Human Lead's yes. The yes at the step confirm is the yes for this move.

## The gate

The gate is the step confirm. The Human Lead answers it. The session never answers it for them.

The session asks through the companion and not in the conversation. It calls the companion's tool `request_gate` with the process `specify`, the step `confirm`, the question, and the path of the draft as what the answer bears on. The tool returns a ticket at once, and the companion shows the gate dialog to the Human Lead. The session then calls the tool `await_answer` with the ticket. While the tool returns the status pending, the session calls it again.

The dialog has three answers: yes, no, and take over. The companion writes the answer to the desk's records, with the process, the step and the question, and returns it to the session. The desk's records are kept outside the Space's folder, and a session cannot write them.

- When the answer is yes, the session goes on to the step agree.
- When the answer is no, the draft is not agreed. The session returns to the step draft, and the draft stays in the Workbench.
- When the answer is take over, the session stops the process. It writes nothing more for this unit of work until the Human Lead asks it to.

## When it runs unattended

The frontmatter has `unattended: true`. An unattended session drafts from what the unit of work says, and it stops at the step confirm until the Human Lead answers the gate in the companion. The process then continues as the answer says. The first build of the companion starts no unattended sessions.

## What it leaves behind

- The agreed spec, as one file in the publish area that the Human Lead confirmed. With the default set, the file is in `publish/specs/`, and the index of that folder lists it.
- A link from the unit of work to the published spec. With the default layout, the link is a comment on the focus issue.
- No draft of this spec in the Workbench.
- The unit of work at its next stage. With the default layout, the Stage field of the focus has the value Plan.
- The Human Lead's answer to the gate, in the desk's records.

The process does not start the process plan. The Human Lead starts plan on the unit of work when they want its breakdown.

## Choices recorded here

The product document of AI-Lore 1.0 gives the four steps, the gate and the two verbs. The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The names of the tools `request_gate` and `await_answer` are taken from a proposal in the architecture document of the first build. The Human Lead has not yet accepted that proposal.
- The product document describes the gate as one dialog that is also the confirmation to enter Writing on the publish area. The focus of the first build names two dialogs of the companion: the entering-Writing dialog, which records the claim, and the gate dialog, which records the answer. The companion's tools follow the focus, and only `request_writing` records a claim. This card follows the focus: it asks the gate with `request_gate`, and spec-agree asks for Writing with `request_writing`. The Human Lead therefore answers two dialogs, one after the other. The Human Lead is asked whether the two should become one.
- The product document puts the move of the focus to Plan in the step agree and does not list it among the things that spec-agree does. This card has the session make the move after spec-agree has finished.
- The product document names the three answers of a gate and says what yes does. What the session does after no and after take over is this card's.
- The product document says that an unattended run of specify blocks at its gate. It also says that Blocked is a state of a session in Writing that has an issue on the Agents board, and a session running specify is in Read only until the step agree. This card says only that the unattended session stops at the gate until the Human Lead answers.
