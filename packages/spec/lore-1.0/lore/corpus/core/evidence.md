---
type: corpus
term: evidence
points_at:
  - lore/verbs/default/work-report.md
---

# Evidence

## What it means

Evidence is what proves that a criterion is met. A piece of work that has [acceptance criteria](./acceptance-criteria.md) is closed by a report against them, and the report names the evidence for each criterion: a test, the output of a command, a screenshot, or the Human Lead's reading.

A unit of work is closed by the Human Lead reading those reports against the agreed spec. In both cases the statement that work is finished is based on something that the Human Lead can check.

What evidence a criterion needs is not fixed. The Lore of the Space says what counts as evidence.

## Where it is kept

Evidence is named in the report on the piece of work, which is written to the plan where the Project layout says a report goes. With the default Project layout the report is the last comment on the issue of the piece of work.

## What acts on it

With the default set, the verb work-report reads the Lore for what counts as evidence, takes the criteria of the piece of work one by one, and states for each one whether it is met and with what evidence. For a criterion whose evidence is the Human Lead's confirmation or reading, the session shows the Human Lead the result and asks, and the answer is the evidence.

## Choices recorded here

- The product document of AI-Lore 1.0 calls a criterion that the Human Lead confirms a gate. The Human Lead decided on 2026-09-18 that the process work has two gates, entering Writing and republishing a changed spec. This entry follows the decision and does not call such a criterion a [gate](./gate.md).
