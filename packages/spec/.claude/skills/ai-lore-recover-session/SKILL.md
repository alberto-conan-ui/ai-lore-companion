---
name: ai-lore-recover-session
description: "AI-Lore process recover-session — after a session died without closing"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/processes/core/recover-session.process.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this process makes is confirmed with the Human Lead.

> **invoker:** human-lead · **composes:** release-track; mount-track; ack; update-focus

# recover-session

The cleanup journey when a session crashed, was killed, or vanished: the track is
stale-mounted, drift sits uncommitted, and the journal's last entry is the only
map. Orient surfaces this state; this process resolves it.

## When to run

- A mount attempt refuses ("already mounted") and the named session is genuinely
  dead — the Human Lead's judgement, never the session's.

## The steps

1. **`release-track`** — clear the stale mount (two fields, nothing more; the
   drift stays honestly dirty).
2. **`mount-track`** — attach fresh; orient's drift check and the dead session's
   last journal entry are the map. Judgement: reconstruct what the dead session
   was doing *before* touching anything.
3. **`ack`** *(keep)* — commit the drift with a message that says what it was and
   that it landed from a recovered session — **or discard**: a conscious Human
   Lead call, made knowing what the diff shows (git checkout of the tree is the
   mechanism; the decision on the record is the point).
4. **`update-focus`** *(as needed)* — the journal trail gets the honest note: what
   the dead session did, what was kept or lost, so the next reader is not
   archaeologing.

## Done looks like

The track mountable and clean; the dead session's work either landed with an
honest message or consciously discarded; the focus trail telling the story.
