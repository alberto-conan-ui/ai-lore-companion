---
type: corpus
term: stage
points_at:
  - lore/contracts/core/stage-gate.md
---

# Stage

## What it means

A stage says how far a [unit of work](./unit-of-work.md) has got, for example whether it is being specified, planned or built. A unit of work is at one stage at a time and moves from one stage to the next.

One thing about stages is fixed: moving a unit of work from one stage to the next is a [gate](./gate.md). It needs the Human Lead's explicit yes and is never a session's own decision.

What the stages are called, how many there are, and which processes cover them is not fixed. The Lore of the Space says it, in the entry for its own Project layout. This card names no stage, because a Space that renames or merges one would then have a core card stating something false about its own plan, with no way to correct it.

## Where it is kept

The stage of a unit of work is recorded on the plan, on GitHub. With the default Project layout it is the value of the [Stage field](../default/stage-field.md), a single-select field on the unit's issue.

## What acts on it

The core contract stage-gate concerns whatever records the stage of a unit of work on the plan. In the first build it has only a rule. With the default set, the process specify moves the unit of work to the next stage after its gate, and so does the process plan. The other moves are made by the Human Lead in GitHub.
