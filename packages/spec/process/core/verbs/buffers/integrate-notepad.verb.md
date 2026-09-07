---
type: verb
name: integrate-notepad
title: integrate-notepad — drain the knowledge inbox
family: buffers
context: ./buffers.md
track: full
home_only: true
writes:
  - notepad (notes removed as routed)
  - destinations, each through its own verb
contracts:
  - golden-rule
updated: 2026-07-02
---

# integrate-notepad

Drain the notepad: walk every note with the Human Lead, route each to its
destination or kill it. The **intake** grooming verb — home-only, because curation
of shared knowledge is home's act; this is how notes captured by light sessions
become the project's standing record.

## When to invoke

- Periodically — the notepad has accumulated; before a save-point; as the `groom`
  process's second step.
- NOT at capture time — routing during capture is exactly the friction
  [`add-note`](./add-note.verb.md) exists to avoid.

## What integration means

**Buffer-never-destination, enforced here.** Every note leaves this verb in exactly
one of five ways:

| Route | Through |
|---|---|
| It's an inviolable rule | [`add-contract`](../blueprint/add-contract.verb.md) (or `update-contract` when it sharpens one) |
| It describes the Payload's shape | [`update-mirror`](../blueprint/update-mirror.verb.md) |
| It's an owned executable | [`add-tooling`](../blueprint/add-tooling.verb.md) / `update-tooling` |
| It was work all along | [`add-backlog-item`](./add-backlog-item.verb.md) |
| It no longer matters | **killed** — deleted, with the Human Lead's nod |

Routing is a rewrite, not a move: the destination artifact is authored in its own
schema through its own verb (each under its own golden-rule confirmation); the note
was raw capture, the artifact is standing record. After routing, the note is deleted
and its index line removed — a routed note left behind is a duplicate, and the
buffer must end each integration **empty or consciously smaller**.

Notes too green to route stay — but staying is a decision the Human Lead makes per
note, and a note that survives several integrations unrouted is a finding in itself
(usually: kill it, or it was a backlog item wearing a note's clothes).

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk the notepad index** — every note, oldest first.
3. **Per note, interview**: read it back, propose the route with a recommendation,
   the Human Lead picks (route / keep / kill).
4. **Execute each route** through its destination verb, then delete the note and its
   index line.
5. **Close with the delta**: N routed (where), N killed, N kept (why).

## Refusals

- Not home / not mounted → refuse; light tracks fill the notepad, home drains it.
- Asked to bulk-route without the interview → refuse; per-note disposal is the
  Human Lead's.

## Related

[`add-note`](./add-note.verb.md) fills · destinations:
[`add-contract`](../blueprint/add-contract.verb.md) · [`update-mirror`](../blueprint/update-mirror.verb.md)
· [`add-tooling`](../blueprint/add-tooling.verb.md) ·
[`add-backlog-item`](./add-backlog-item.verb.md). Sibling groomer:
[`review-backlog`](./review-backlog.verb.md) — often chained (intake feeds the
backlog, then the backlog gets polished). Composed by the `groom` process.
