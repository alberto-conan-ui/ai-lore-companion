---
name: ai-lore-review-backlog
description: "AI-Lore verb review-backlog — polish the work inbox"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** buffers · **track:** full · **home only:** true · **writes:** status/backlog/ (items merged, sharpened, killed; indexes rewired); graduations through add-new-focus · **contracts:** golden-rule

# review-backlog

Curate the backlog with the Human Lead: dedupe, merge, sharpen, graduate what the
project now commits to, kill what it never will. The backlog's grooming verb —
home-only.

## When to invoke

- Periodically — before planning a release, after one ships, when the backlog's
  size exceeds anyone's memory of it.
- After [`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) — intake feeds the
  backlog; polish follows naturally (the `groom` process chains them).
- NOT for capture (that is [`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md)) and NOT
  for working an item (graduate it first; the backlog is not a workboard).

## What the review does

Walk every item and folder, oldest first, with the tree's current state as context
(an item may have been done by other work, superseded by a focus, or split by
events). Per item, the dispositions:

- **Graduate** — the project commits now: route to
  [`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md), which absorbs the item's content and
  removes it. Graduation may batch: several items become one focus's context.
- **Merge** — duplicates and near-duplicates collapse into the sharpest one;
  `[[slug]]` links repaired.
- **Sharpen** — an item gone vague gets rewritten against today's reality (what
  would a stranger need to act on this?).
- **Kill** — overtaken, obsolete, or never-really-meant: deleted with the Human
  Lead's nod. A reasoned kill is recorded in the review's close, not mourned.
- **Keep** — still right, still waiting; touch nothing.

Folder hygiene rides along: empty groups dissolve, overgrown roots get grouped,
every index stays pure wiring. The review never *creates* work items — findings
about the project itself route through their own capture verbs.

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk the backlog** — every folder, every item, against the tree's state.
3. **Interview** item by item: evidence, reading, proposed disposition,
   Human Lead's call.
4. **Execute** — merges and sharpenings in place; graduations through
   `add-new-focus` (each under its own confirmation); kills deleted; indexes
   rewired.
5. **Close with the delta**: graduated / merged / sharpened / killed / kept.

## Refusals

- Not home / not mounted → refuse.
- Asked to bulk-kill or auto-graduate without the interview → refuse; disposition is
  per-item and the Human Lead's.

## Related

[`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md) fills ·
[`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) the graduation target ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) the upstream inbox ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) may send stale drafts back here.
Composed by the `groom` process.


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
