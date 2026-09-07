---
type: verb
name: orient
title: orient — the session-opening bookend
family: bookends
track: n/a (runs trackless, before any mount)
invoker: session (intrinsic — no external trigger)
writes:
  - none
contracts:
  - golden-rule
updated: 2026-07-02
---

# orient

The session-opening bookend. Its aim: by the first question, the session is
**expert on the active task** — answering informed, not scrambling. The session runs
it on itself at every open; the Human Lead never invokes it. An engine binding may
reinforce it with a session-start hook; the methodology never depends on that.

## What orient loads

1. **The floor** — `ai_readme.md` (the golden rule, the resolution chain, this
   pointer). Usually already read; it is how the session got here.
2. **The thin core**, from the resolved verb set (`blueprint/verbs/core/` unless
   shadowed): `project-structure.md` (vocabulary), `status.md` (the status tree and
   registry), `verbs.index.md` (the map). Everything else loads when invoked — a
   verb is high-signal at invocation, degraded when carried from open.
3. **The registry**: `status/status.stack.md` (focuses, statuses, active-marks) and
   `status.index.md` (root wiring). The open-tracks picture from `tracks/`.
4. **Parents, eagerly but shallowly**: the manifest's `parents:` resolved far enough
   that inherited artifacts are *invocable* (names known); their content still loads
   on invocation.

## Track-aware depth

The session starts **trackless in every case**; mounting is a separate act.

- **Only home open** → assume the session lands there. Walk the chain from home's
  focus down through stages and phases to the tip; read the newest journal
  handover, the blueprint areas the focus names. Single-session projects pay no
  parallelism tax.
- **Other tracks open** → defer the walk. State the open tracks and put the choice
  to the Human Lead: mount one now, or stay trackless. Walk only what gets mounted.

## The drift check

Per open track, both repos, explicitly:

```
git -C <project> status          # Payload repo
git -C <lore>/memory status      # lore repo — its .git lives HERE, not at <lore>/
```

against each track's branches — home's branch as its **record** names it (`trunk`
in role-language; commonly `main` in reality — the record is authoritative),
`track/<name>` for children. Dirty = unacknowledged work, surfaced per track;
drift is derived here and stored nowhere. A `mounted_by` naming a session that no
longer exists is surfaced too — [`release-track`](../tracks/release-track.verb.md) is the
Human Lead's remedy.

## The readout

One statement: open tracks (name, focus, mounted-by) · per-track drift · the walked
chain's tip · the next step per the newest handover. Headless project (no focus, no
tracks beyond an idle home): say so and wait. Multiple open tracks: name the
mount-or-trackless choice. Then stop — orient ends where the Human Lead's first
real instruction begins.

## Refusals

- Writing anything → orient is read-only by definition; the first write of the
  session triggers the mount flow through its own verb.
- Skipping the drift check "to save time" → the check *is* the time saved.

## Related

[`mount-track`](../tracks/mount-track.verb.md) the write-capable follow-up ·
[`close-session`](./close-session.verb.md) the closing twin ·
[`release-track`](../tracks/release-track.verb.md) for stale mounts orient surfaces.
