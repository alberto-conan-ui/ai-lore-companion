---
type: verb
name: mount-track
title: mount-track — attach a session to a workspace
family: tracks
context: ./tracks.md
track: n/a (this verb creates the session's track state)
writes:
  - track record (mounted_by, claim seeding)
  - status.stack.md (active-mark)
  - git checkout of the track's branches (children)
contracts:
  - golden-rule
updated: 2026-07-02
---

# mount-track

Attach a session to an **existing full track** — the entry to write-capable state. A
trackless session reads everything and writes nothing; mounting is what changes
that.

## When to invoke

- Explicitly, when the Human Lead knows the track up front.
- Implicitly, the moment a trackless session is asked to make a full-track write —
  every writing verb routes here when unmounted. The **fast path**: if the only
  candidate is home and home is free, auto-mount silently and proceed; the
  single-session project never feels the machinery.
- NOT for journal/backlog/notepad-only writes — that is light-track work, unmounted
  by design.

## What mounting means

Types, one-per rules, registration, claims: [`tracks.md`](./tracks.md). What this
card adds: **home** needs no checkout (it is the trunk-role branch) and seeds its
claim from the active focus on first mount (an already-set claim is preserved —
focus switch re-seeds, not plain mount); **children** check out `track/<name>` on
**both** repos — one repo on the branch with the other on trunk is a torn state.
Then walk the chain from the track's focus to its tip — a mounted session is expert
on its focus, not just permitted to write it. A `draft` focus moves to
`in progress` on first work, no ceremony.

## The operation

1. **Confirm the verb** (golden rule) — silent on the auto-mount fast path, which is
   its one sanctioned elision (the write that triggered it carries the
   confirmation).
2. **Resolve the candidate**: named track, or home (fast path), or ask the Human
   Lead when home is taken and children exist.
3. **Verify mountable**: exists, and `mounted_by` is blank (a dead session's stale
   mount is [`release-track`](./release-track.verb.md)'s business — never steal).
4. **Check out branches** (child), **register** (`mounted_by`, active-mark, claim
   seeding), **walk the chain**.
5. **State the mount**: track, claim, focus, chain tip.

## Refusals

- Track already mounted → refuse; point at `release-track` if the holder is dead.
- Track does not exist → refuse; `spawn-track` from home first.
- Session already mounted → refuse; one track per session, close to switch.

## Related

[`spawn-track`](./spawn-track.verb.md) creates ·
[`release-track`](./release-track.verb.md) recovers stale mounts ·
[`update-track`](./update-track.verb.md) polishes the claim ·
[`orient`](../bookends/orient.verb.md) runs the same chain walk at session open ·
[`close-session`](../bookends/close-session.verb.md) unmounts.
