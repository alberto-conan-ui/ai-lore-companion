---
type: process
name: plan
pillar: planning
steps:
  - read-unit
  - break-down
  - hand-over
gates:
  - break-down
unattended: true
---

# plan

## What it is for

This process produces the breakdown of a unit of work that has an agreed spec. The breakdown is the list of the pieces of work, each with acceptance criteria drawn from the spec, and the dependencies between the pieces. The session proposes the breakdown, the Human Lead edits the list and confirms it, and the session writes it to the plan. The plan is on the Space's GitHub Project and not in files.

A planned item is optional. The Human Lead can ask a session for work that is on no issue, and the session does that work. A piece of work that has no spec does not need this process: the Human Lead writes it on the plan as a standalone item, which is an issue under no unit of work.

The process has three steps: read-unit, break-down and hand-over. The step break-down is its one gate. No step of this process runs another process.

## When the Human Lead starts it

The Human Lead starts plan by its name, in a session, on a unit of work whose spec is agreed and published, when they want the pieces of work on the plan. With the default layout, which the entries in `lore/corpus/default/` describe, this is a focus whose Stage field has the value Plan.

The session can be in Read only for the whole process. The process writes only to the plan on GitHub, and a session in Read only may write to the plan.

## The steps

### read-unit

This step uses no verb.

The session reads the unit of work, its agreed spec and its existing breakdown. If the unit of work has no agreed spec, the process stops and the session says so. The core contract spec-before-breakdown gives the reason: a unit of work that is being specified has no breakdown until its spec is agreed, and its breakdown and criteria are drawn from that spec.

### break-down

This step uses the verb plan-break-down. It is the gate of the process.

The session runs plan-break-down. The verb proposes the pieces of work, each with its acceptance criteria drawn from the spec, and states any part of the spec that no piece covers. The Human Lead edits the list. When the Human Lead says that the list is right, the session asks the gate, as the section "The gate" below says. After a yes, plan-break-down writes the breakdown to the plan as the layout says, and closes what the Human Lead removed from an existing breakdown.

With the default layout, the pieces of work are items. An item is a sub-issue of the focus, and its acceptance criteria are in the body of the sub-issue.

### hand-over

This step uses no verb. It runs only after the breakdown is written.

The session checks that every piece of work of the confirmed list is on the plan with its criteria. It then moves the unit of work to its next stage. With the default layout, it sets the Stage field of the focus to Build. The core contract stage-gate says that a unit of work moves from one stage to the next only with the Human Lead's yes. The yes at the step break-down is the yes for this move.

The step does not start the process work. The Human Lead starts work on each item.

## The gate

The gate is the step break-down. The Human Lead answers it. The session never answers it for them.

The session asks through the companion and not in the conversation. It calls the companion's tool `request_gate` with the process `plan`, the step `break-down`, the question whether this breakdown is confirmed, and the list as what the answer bears on. The tool returns a ticket at once, and the companion shows the gate dialog to the Human Lead. The session then calls the tool `await_answer` with the ticket. While the tool returns the status pending, the session calls it again.

The dialog has three answers: yes, no, and take over. The companion writes the answer to the desk's records, with the process, the step and the question, and returns it to the session. The desk's records are kept outside the Space's folder, and a session cannot write them.

- When the answer is yes, plan-break-down writes the breakdown to the plan, and the session goes on to the step hand-over.
- When the answer is no, nothing is written to the plan. The session stays at the step break-down, and the Human Lead goes on editing the list.
- When the answer is take over, the session stops the process and writes nothing to the plan. The Human Lead writes the breakdown themselves.

## When it runs unattended

The frontmatter has `unattended: true`. An unattended session proposes the list and stops at the step break-down until the Human Lead answers the gate in the companion. The process then continues as the answer says. The first build of the companion starts no unattended sessions.

## What it leaves behind

- The pieces of work on the plan, each with acceptance criteria drawn from the agreed spec, and the dependencies between them. With the default layout, they are sub-issues of the focus.
- The unit of work at its next stage. With the default layout, the Stage field of the focus has the value Build.
- The Human Lead's answer to the gate, in the desk's records.
- Nothing in the Lore, in a payload or in the Workbench.

## The stage Review

No process covers the stage Review. With the default layout, when every item of a focus is Done, the Human Lead moves the focus to Review, reads the reports on its items against the agreed spec, and moves the focus to Done. The Human Lead makes both moves in GitHub. A session makes neither.

## Choices recorded here

The product document of AI-Lore 1.0 gives the three steps, the gate and the verb. The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The names of the tools `request_gate` and `await_answer` are taken from a proposal in the architecture document of the first build. The Human Lead has not yet accepted that proposal.
- The product document names the third step "Hand over to work" and says what is true when it is reached. This card gives the step two actions: checking that the confirmed pieces are on the plan, and moving the unit of work to its next stage.
- The product document names the three answers of a gate and says what yes does. What the session does after no and after take over is this card's.
- The product document says that an unattended run of plan writes the proposed list on the session's issue. It also says that a session gets its issue when it first enters Writing, and this process runs in Read only. Where the list is written when the session has no issue is not settled, so this card does not say where. The product document also says that an unattended run blocks at the gate, and that Blocked is a state of a session in Writing. This card says only that the session stops at the gate until the Human Lead answers.
