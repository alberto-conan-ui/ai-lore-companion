---
type: verb
name: add-note
title: add-note — capture a thought into the notepad
family: buffers
context: ./buffers.md
track: light
writes:
  - notepad (one new note file + index entry)
contracts:
  - golden-rule
updated: 2026-07-02
---

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
  [`add-backlog-item`](./add-backlog-item.verb.md). Notes are *knowledge*; backlog
  items are *work*. When in doubt at capture time, either is fine — the grooming
  verbs re-route across the buffers.

## Where it lands

The notepad, its note shape, and the buffer-never-destination rule:
[`buffers.md`](./buffers.md). This card's whole discipline: capture with enough
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

[`integrate-notepad`](./integrate-notepad.verb.md) drains and routes ·
[`add-backlog-item`](./add-backlog-item.verb.md) the work-item sibling ·
[`close-session`](../bookends/close-session.verb.md) journals the session that noted.
