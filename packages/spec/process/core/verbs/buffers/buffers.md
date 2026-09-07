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
[`integrate-notepad`](./integrate-notepad.verb.md), where every note leaves as a
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
[`add-new-focus`](../status-tree/add-new-focus.verb.md) absorbs the item and
removes it) or **death** ([`review-backlog`](./review-backlog.verb.md) kills what
no longer matters).
