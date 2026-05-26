---
name: ai-lore-save-point
description: Formal milestone — commit, ledger entry, blueprint-contract check
---

# save-point

A save-point marks a strong reference point — a state in the project worth being able to return to. The Human Lead invokes it at milestones; the session never self-save-points.

## What every save-point is

- **A commit in both repos.** The lore repo (`<lore>/memory/`) and the Payload repo (the Project root), each at HEAD. The pair of commits is the return point.
- **A ledger entry that says what this moment means.** One file in `memory/save-points/`. The git history records the commits; the ledger entry describes the milestone.
- **A blueprint check.** Any contract in `memory/blueprint/contracts/` that applies to save-points is read first. A failing contract blocks the save-point until the Human Lead resolves or explicitly overrides it; overrides are recorded in the ledger entry.

A dirty working tree is acknowledged implicitly by the save-point's commits — there is no separate ack step.

## At invocation

The Human Lead invokes; the session helps draft both the commit message and the ledger description; the HL confirms; the session commits both repos and writes the entry through [`write-lore`](./write-lore.md).

The session may also offer archiving at the same invocation — stale focuses, completed AT subtrees, rolled journal files — and the Human Lead confirms what to move. On a save-point with nothing to archive, the offer is skipped.

## The ledger

`memory/save-points/` is append-only. It never rolls and is never archived — a save-point must stay reachable forever, which is why journal files (which do roll) cannot hold it.

## Relationship to ack

[`ack`](./ack.md) is the lightweight cousin: the commit shape only, no ledger entry, no blueprint check, no archive offer. A session may `ack` many times between save-points.
