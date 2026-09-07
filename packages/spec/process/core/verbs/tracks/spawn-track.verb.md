---
type: verb
name: spawn-track
title: spawn-track — open a child workspace
family: tracks
context: ./tracks.md
track: full
invoker: human-lead
writes:
  - tracks/<name>.track.md (new record)
  - tracks index
  - git branches track/<name> on both repos
contracts:
  - golden-rule
updated: 2026-07-02
---

# spawn-track

Create a **child track** from home: record + branches, deliberately, before any
session mounts it. **Human-Lead-managed** — parallelism is a project decision, not a
session convenience.

## When to invoke

- Contention requires it: a second stream of work wants to proceed while home is
  busy, on a disjoint area.
- NOT to attach the current session (that is
  [`mount-track`](./mount-track.verb.md) — a different act, usually a different
  session) and NOT for a quick journal/backlog/notepad jot (a light track needs no
  spawn, no record, no branch).

## What spawn settles

The track primitive, types, claims, and lifecycle: [`tracks.md`](./tracks.md).
Spawn settles three things with the Human Lead — **name** (unique among open
tracks), **claim** (strictly disjoint from every open track's, verified here at
creation), **focus pointer** (optional; exploratory children are legal) — then
writes the record and branches `track/<name>` on both repos. It never attaches a
session; that is mount's act, usually a different session's.

## The operation

1. **Verify the invoker** is the Human Lead, and the session is home-mounted.
2. **Confirm the verb** (golden rule).
3. **Settle the design**: name, claim (verify disjointness against every open
   track), focus pointer if any.
4. **Branch both repos**: `track/<name>` on the Payload repo and the lore repo, from
   the current trunk state.
5. **Write the record** and wire the tracks index.
6. **State the child's shape** — it exists unmounted; a session attaches via
   `mount-track`.

## Refusals

- Invoked from a child track → refuse; children are spawned from home only.
- Claim overlaps an open track → refuse; recut the claims with the Human Lead.
- Name collides with an open track → refuse.

## Related

[`mount-track`](./mount-track.verb.md) attaches ·
[`merge-track`](./merge-track.verb.md) / [`abandon-track`](./abandon-track.verb.md)
end it · [`update-track`](./update-track.verb.md) reshapes the claim mid-life ·
[`save-point`](../acknowledgement/save-point.verb.md) refuses while children are open.
