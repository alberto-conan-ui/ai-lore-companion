---
type: corpus
term: gate
points_at:
  - lore/processes/index.md
  - lore/contracts/core/stage-gate.md
---

# Gate

## What it means

A gate is a step of a [process](./process.md) that needs the Human Lead's yes. The card of a process declares its gates. A step that is not a gate runs without asking.

Inside [Writing](./writing.md), the gates that the process declares are the only confirmations. Entering Writing is itself always confirmed by the Human Lead, and the default process work counts it as its first gate.

One gate is fixed for every Space: moving a [unit of work](./unit-of-work.md) from one [stage](./stage.md) to the next is the Human Lead's explicit yes and never a session's own decision.

An attended session that reaches a gate asks. An unattended session that reaches a gate moves to [Blocked](./blocked.md) and waits for the Human Lead's answer.

## Where it is kept

The gates of a process are the key `gates` in the frontmatter of its card. Every gate is also one of the steps of the process.

The Human Lead answers a gate in a dialog of the companion. The answers are yes, no, and taking the piece of work over. The companion records the answer in the desk's records, and a session cannot write that record. A gate that is answered outside the companion is a rule only.

## What acts on it

The three default processes declare these gates. specify has one: the Human Lead declaring the draft agreed. plan has one: the Human Lead confirming the breakdown. work has two: entering Writing, and republishing a spec that has changed. The core contract stage-gate reads the companion's record of the Human Lead's yes. In the first build that contract has only a rule.
