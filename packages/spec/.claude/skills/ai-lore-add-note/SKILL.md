---
name: ai-lore-add-note
description: "AI-Lore verb add-note — capture a thought into the notepad"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** buffers · **track:** light · **writes:** notepad (one new note file + index entry) · **contracts:** golden-rule

# add-note

Capture a thought into the **notepad** — the project's knowledge inbox. The
deliberately cheapest write in AI-Lore: no routing, no structuring, no decisions
beyond "worth keeping."

## When to invoke

- Mid-work, something surfaces that matters later but not now: an observation, a
  defect smell, a design idea, a "the docs say X but reality does Y."
- From a **light track** — this is one of its three legal surfaces (journal, backlog,
  notepad); no mount ceremony required.
- NOT for work items ("we should build…") — that is
  [`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md). Notes are *knowledge*; backlog
  items are *work*. When in doubt at capture time, either is fine — the grooming
  verbs re-route across the buffers.

## Where it lands

The notepad, its note shape, and the buffer-never-destination rule:
[`buffers.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/buffers.md). This card's whole discipline: capture with enough
context to survive the gap to the integrating session, make no routing decisions
now, and get back to work in seconds.

## The operation

1. **Confirm the verb** (golden rule): usually one breath — "noting this,
   `add-note`?" — the Human Lead confirms. Light track or full track both serve.
2. **Write the note**: slug, minimal frontmatter, the thought with just enough
   context to survive the context gap.
3. **Add the index line** in `notepad/notepad.index.md`.
4. **Return to the interrupted work** — capture is a detour measured in seconds.

On a light track the write lands as drift on trunk for a home session to
acknowledge; that is by design, not an error.

## Refusals

- Trackless session → even the cheap write needs a track type that writes; operate
  as a light track (this is the verb light tracks exist for).
- A note that is really a structured artifact draft (a whole contract, a process) →
  capture the pointer as a note if the moment is wrong, or route to the blueprint
  verb if the moment is right.

## Related

[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) drains and routes ·
[`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md) the work-item sibling ·
[`close-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/close-session.verb.md) journals the session that noted.


---

# Family context

# The buffers — family context

The shared knowledge of the buffer family. Verb cards in this folder assume it.

## The buffer pattern

Two inboxes with one design: **capture is frictionless from anywhere; curation is
deliberate and home-gated.** Light tracks may write both buffers (plus the journal
— their three legal surfaces, landing as trunk drift for home to acknowledge);
only home drains them, through the grooming verbs, with the Human Lead disposing
per item. **Buffer, never destination**: everything captured eventually graduates
into standing record or dies — nothing lives in a buffer.

The notepad is to **knowledge** what the backlog is to **work**. Misfiled captures
are cheap: the grooming verbs re-route across the buffers.

## The notepad

`memory/notepad/` — a flat folder of notes plus its index; the knowledge inbox.
One file per note, `<slug>.note.md`: frontmatter (`type: note`, `title`, `updated`,
`source` opt) + the observation as it came, with enough context to survive the gap
to the integrating session. No routing decisions at capture time — that is the
whole point; routing happens at
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md), where every note leaves as a
contract, a mirror update, a tooling entry, a backlog item — or dies.

## The backlog

`memory/status/backlog/` — pre-focus work annotations. Deliberately informal: a
tree of folders and typed item files (`<slug>.item.md`, frontmatter `type:
backlog-item`, `title`, `updated`, `status` opt), grouped as the work wants, no
positional rules, no depth cap. Two disciplines only: every folder carries a pure-
wiring index; every item is self-contained enough that a stranger could act on it.

The backlog is **not** part of the focus tree and never appears in
`status.stack.md` — an item is what a focus is before commitment. Items leave by
**graduation** (the project commits;
[`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) absorbs the item and
removes it) or **death** ([`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) kills what
no longer matters).
