---
type: corpus
term: Blocked
points_at: []
---

# Blocked

## What it means

Blocked is the state of an [unattended](./attended-and-unattended.md) session in Writing that is waiting at a [gate](./gate.md). It is not a third [mode](./mode.md).

An unattended session that reaches a gate does not wait for an answer in the conversation. It records on its issue what it would have asked, moves to Blocked, keeps its write targets so that no other session writes over work that is half finished, and stops writing. The Human Lead answers in the companion, and the companion resumes the session or starts a new one from its handover.

## Where it is kept

Blocked is a column of the [Agents board](./agents-board.md). The issue of a blocked session is in that column, and it has the question that the session would have asked.

## What acts on it

The Human Lead's answer to the gate, given in the companion, ends the state. With the contract stage-gate, an unattended session that would move a unit of work to its next stage without the Human Lead's recorded yes moves to Blocked instead. The first build of the companion does not start unattended sessions, so no session is Blocked in it.
