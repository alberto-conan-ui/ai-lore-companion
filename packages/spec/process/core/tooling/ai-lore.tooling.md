---
type: tooling
name: ai-lore
title: ai-lore — the core tool (resolve · check · install · upgrade · init · migrate)
updated: 2026-09-07
path: blueprint/tooling/core/ai-lore.py
---

# ai-lore.py

The mechanical half of six verbs, in one stdlib-only Python 3 script. The verb
decides and confirms; the tool executes. It ships in core (`blueprint/tooling/core/`)
and in the distribution (`process/core/tooling/`), replaced wholesale by `upgrade`.

## Invocation

```
python3 <lore>/memory/blueprint/tooling/core/ai-lore.py <command> [--project DIR]
```

| Command | Serves | Does |
|---|---|---|
| `resolve [--json]` | every verb that reads the resolved set; `add-parent` / `remove-parent` | walks core < parents (declaration order) < local by name, lowest wins; contracts accumulate; prints provenance and shadows |
| `check [--from DIST] [--since REF]` | `init`, `upgrade`, `save-point`'s contract walk | core-containment (floor present, no vendored tree, nothing artifact-shaped outside `blueprint/`), core vs distribution, dead links in blueprint and projections, contract citations and process steps resolve, accumulator present, journal-append-forward by git history |
| `install claude \| gemini` | `install`, and the authoring verbs' incremental wiring | projects the *resolved* set: verb/process → skill (card + family context bundled, links rewritten), contracts → guard hook, bookends → session hooks, handshake block; removes stale `ai-lore-*` projections |
| `upgrade --from DIST` | `upgrade` | replaces every `core/` wholesale with link transform + generated indexes, lists local shadows for the Human Lead's re-validation, bumps `core_version`, re-projects installed engines |
| `init DIR --name N --from DIST [--branch B] [--publishing] [--lore-remote URL]` | `init` | the whole initial shape: floor, Lore, core, Memory skeleton with the first open accumulator, two git repos, first paired commit + row |
| `migrate --from DIST` | the v0.7 → v0.8 playbook | F7 manifest move, core placement, vendored tree removed, root shim, knowledge-tree → notepad, accumulator opened, F6 branch, pin, re-projection, check |

`DIST` is a checkout of the ai-sdlc repository (or its `process/` folder); the
version comes from `process/core/VERSION`.

## When to reach for it

Whenever the owning verb reaches its mechanical step. Never as a substitute for
the verb's confirmation: the golden rule holds for every write the tool makes —
name the verb, the Human Lead confirms, then run.

## What it must not be used for

- Editing `core/` — it never does; neither should you.
- Committing — the ack family owns commits (only `init` commits, once, and appends
  its row).
- Deciding shadow fates — it lists them; the Human Lead walks them.
