---
name: ai-lore-integrate-notepad
description: "AI-Lore verb integrate-notepad — drain the knowledge inbox"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** buffers · **track:** full · **home only:** true · **writes:** notepad (notes removed as routed); destinations, each through its own verb · **contracts:** golden-rule

# integrate-notepad

Drain the notepad: walk every note with the Human Lead, route each to its
destination or kill it. The **intake** grooming verb — home-only, because curation
of shared knowledge is home's act; this is how notes captured by light sessions
become the project's standing record.

## When to invoke

- Periodically — the notepad has accumulated; before a save-point; as the `groom`
  process's second step.
- NOT at capture time — routing during capture is exactly the friction
  [`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) exists to avoid.

## What integration means

**Buffer-never-destination, enforced here.** Every note leaves this verb in exactly
one of five ways:

| Route | Through |
|---|---|
| It's an inviolable rule | [`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md) (or `update-contract` when it sharpens one) |
| It describes the Payload's shape | [`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md) |
| It's an owned executable | [`add-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-tooling.verb.md) / `update-tooling` |
| It was work all along | [`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md) |
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

[`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) fills · destinations:
[`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md) · [`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md)
· [`add-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-tooling.verb.md) ·
[`add-backlog-item`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-backlog-item.verb.md). Sibling groomer:
[`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) — often chained (intake feeds the
backlog, then the backlog gets polished). Composed by the `groom` process.


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
