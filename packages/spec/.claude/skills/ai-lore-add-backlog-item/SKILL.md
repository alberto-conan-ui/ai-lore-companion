---
name: ai-lore-add-backlog-item
description: "AI-Lore verb add-backlog-item — capture future work, pre-focus"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** buffers · **track:** light · **writes:** status/backlog/ (one new item file + index wiring) · **contracts:** golden-rule

# add-backlog-item

Capture a piece of **future work** into the backlog — a to-do the project has not
committed to. Cheap on purpose: a backlog item costs nothing until it graduates.

## When to invoke

- A defect, follow-up, or idea surfaces that deserves doing but not now.
- A finding is filed during a release or review (the classic `F<N>` items).
- From a **light track** — one of its three legal surfaces.
- NOT for knowledge (that is [`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md)) and NOT for work being
  committed to right now (that is [`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) — skip
  the buffer when commitment is already here).

## Where it lands

The backlog's shape, item schema, and the graduation/death exits:
[`buffers.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/buffers.md). This card's discipline: the item is self-contained
(a stranger could act on it years later), placed in a fitting group, and costs
nothing until the project commits.

## The operation

1. **Confirm the verb** (golden rule); light or full track both serve.
2. **Place it**: an existing backlog folder that fits, or the backlog root; create a
   grouping folder (with its index) only when siblings already exist to group.
3. **Write the item**: slug, frontmatter, self-contained body.
4. **Wire the index** of the folder it landed in.
5. **Return to the interrupted work.**

On a light track the write lands as drift on trunk for a home session to
acknowledge — by design.

## Refusals

- Trackless → operate as a light track.
- Commitment is actually present ("let's do this next") → skip the buffer, route to
  `add-new-focus`.
- It's knowledge, not work → `add-note`.

## Related

[`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) polishes and graduates ·
[`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) the graduation target ·
[`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) the knowledge sibling ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) routes notes here when they were
work all along.


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
