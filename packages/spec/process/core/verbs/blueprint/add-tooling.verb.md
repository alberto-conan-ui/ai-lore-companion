---
type: verb
name: add-tooling
title: add-tooling — register an owned executable
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/tooling/ (new *.tooling.md) + branch index
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-tooling

Register a **tooling entry** — the catalog card for an executable resource the
project owns: a build script, a generator, an auxiliary app.

## When to invoke

- The project gains (or already quietly has) a script/tool sessions should reach for
  instead of re-deriving its work by hand.
- NOT for the executable itself — **the tool lives in the Payload** (written via
  [`update-payload`](../payload/update-payload.verb.md) or a project verb); the registry is
  the pointer. And NOT for a checklist the session executes by hand — that is a
  process.

## What a tooling entry is

The distinction that keeps the branch honest: a **process** is a checklist the AI
executes; a **tooling entry** points at something that *executes for it*. One file
per tool, `<name>.tooling.md`: frontmatter (`type: tooling`, `name`, `title`,
`updated`, `path` — where in the Payload it lives); body — its purpose, how to
invoke it (the actual command), when to reach for it, what it must not be used for.
Enough that a session that has never seen it runs it right the first time.

Tooling entries are plain registry cards — no core/shadow subtlety in practice
(core ships none; they are inherently project-specific), though the resolution
chain applies formally like everywhere in `blueprint/`.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/tooling/`.
2. **Verify the tool exists** at the stated path and the invocation line actually
   runs (a registry card for a broken tool is worse than none).
3. **Author the card**; wire the branch index.
4. **State the addition.**

## Refusals

- The tool doesn't exist yet → build it first (Payload work), then register.
- It's a hand-checklist → [`add-process`](./add-process.verb.md).

## Related

[`update-tooling`](./update-tooling.verb.md) ·
[`retire-tooling`](./retire-tooling.verb.md) ·
[`update-payload`](../payload/update-payload.verb.md) builds the tools this registers ·
[`integrate-notepad`](../buffers/integrate-notepad.verb.md) routes tool-discoveries here.
