---
type: contract
name: core-containment
title: core-containment — light bootstrap, everything else in blueprint
updated: 2026-09-07
checkable: yes
cited_by:
  - init
  - upgrade
  - install
---

# core-containment

**A project carries the methodology as exactly two things: the floor at the
project root (`ai_readme.md` plus the Lore's `ai_readme.md`), and artifacts under
`<lore>/memory/blueprint/{verbs,processes,contracts,tooling}/` — with the
out-of-the-box set in each branch's `core/`.** No vendored methodology tree exists
anywhere else, and `core/` is never edited in place.

## What honoring it looks like

- **The floor is small** — golden rule, resolution chain, opening steps, the
  un-overridable floor named. Everything operational lives in an artifact and
  loads when invoked.
- **`core/` is replaced wholesale** by [`upgrade`](../verbs/lifecycle/upgrade.verb.md)
  and placed by [`init`](../verbs/lifecycle/init.verb.md); customization is
  shadow-by-name outside `core/`. A hand edit inside `core/` is the violation that
  turns the next upgrade into a textual merge.
- **Engine projections are derived** (`.claude/skills/`, `.gemini/commands/`) —
  regenerable by [`install`](../verbs/lifecycle/install.verb.md) from the
  resolved set, never the source of anything.

## What checks it

- **`ai-lore.py check`** (shipped in `blueprint/tooling/core/`): the floor exists at
  both locations; no `<lore>/process/` tree; every `*.verb.md` / `*.process.md` /
  `*.contract.md` sits under `blueprint/`; each `core/` matches the distribution
  it was placed from (the pin in `workspace.yaml` names it). Run by `init` and
  `upgrade` as their last step, and at [`save-point`](../verbs/acknowledgement/save-point.verb.md)'s
  walk.
- **A fresh install** (the gatekeeper): `init` on an empty folder yields a project
  whose only methodology outside `blueprint/` is the floor.
