---
type: corpus
term: Planning
points_at:
  - lore/processes/default/plan.md
  - lore/contracts/core/stage-gate.md
---

# Planning

## What it means

Planning is the [pillar](./pillar.md) of deciding what to build, in what order, and who is building it now. AI-Lore has no planning tool of its own. The plan is on the Space's GitHub Project, which has issues for the units of work, sub-issues for their breakdown, fields for their state, labels for their kind, dependencies between them, and views that group and filter them. No file in the Space copies any of this.

A planned item is optional. A session can do work that is on no issue. When the work does concern an issue on the plan, the session keeps that issue up to date as the Lore says.

One thing about Planning is fixed. Moving a [unit of work](./unit-of-work.md) from one [stage](./stage.md) to the next is a [gate](./gate.md): it needs the Human Lead's explicit yes and is never a session's own decision. Which fields the Project has, what the stages are called, how the breakdown is done and which views exist is not fixed. The Human Lead changes these by changing the files in the Lore that describe them.

## Where it is kept

The plan is kept on GitHub, in the issues of the Space repository and in the Space's GitHub Project. The Human Lead edits it in GitHub's interface, and a session edits the same issues and fields from the command line. The same Project is where the sessions that write are shown, on the [Agents board](./agents-board.md).

## What acts on it

With the default set, the process plan produces the [breakdown](./breakdown.md) of a unit of work with the verb plan-break-down. The core contract stage-gate guards this pillar. A session in Read only may update the plan, because the plan is neither a payload nor the Lore.
