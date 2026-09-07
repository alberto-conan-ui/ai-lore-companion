---
type: verb
name: init
title: init — bootstrap a folder into an AI-Lore project
family: lifecycle
track: n/a (creates the project this machinery runs in)
invoker: human-lead
writes:
  - the whole initial shape — bootstrap, Lore, Memory skeleton, git arrangement
contracts:
  - golden-rule
  - core-containment
updated: 2026-07-02
---

# init

Bootstrap a folder into an AI-Lore project: the floor at the root, core in the
blueprint, Memory's skeleton, two git repos wired for the pairing discipline.
Run once per project, with the Human Lead.

## When to invoke

- A folder (empty or already holding working materials) becomes an AI-Lore project.
- NOT for moving versions ([`upgrade`](./upgrade.verb.md)) or wiring an engine
  ([`install`](./install.verb.md)).

## What init creates

**The shape** (settled with the Human Lead first — name, and Default vs Publishing):

- **The floor**: `ai_readme.md` at the project root — golden rule, resolution
  chain, orient pointer, authoring verbs. The whole methodology a session must
  carry *before* reaching an artifact; everything else loads on invocation.
- **The Lore**: `.ai-lore-<project_name>/` (name from the manifest;
  `^[a-zA-Z0-9_][a-zA-Z0-9_-]*$` — unique folder per project so ancestor-walk
  resolution never ambiguates), containing:
  - `memory/workspace.yaml` — `project_name`, `core_version`, optional `publish:`
    and `parents:` — **inside the Memory repo** (version bumps leave a trace).
  - `memory/blueprint/{verbs,processes,contracts}/core/` — **the OOB artifact set,
    placed here**; per the core-containment contract, no vendored methodology tree
    exists anywhere else. Branch folders ready for local artifacts beside `core/`.
  - The Memory skeleton: `status/` (+ `status.stack.md`, `backlog/`), `tracks/`
    (home's record — `branch:` set to the repo's real branch name; the record is
    authoritative), `journal/live/`, `notepad/`, `save-points/` with the **first
    open `next.save-point.md` accumulator**, `mirror/`+`tooling/` branches — every
    folder with its index, emptiness valid everywhere.
- **The git arrangement**: the project root as the Payload repo (`.gitignore`:
  `.ai-lore-<project>/`, `publish/`, `out/`); `<lore>/memory/` as its own repo
  (the location wart to know: its `.git/` is at `memory/.git/` — address it
  explicitly, `git -C <lore>/memory`). **The Lore-remote conversation happens
  here**: Memory is the project's entire durable record, and unbacked memory is
  the sharpest durability risk a remembering methodology can have — settle a
  remote (or a conscious "local-only, because…") at birth, not after the first
  scare.
- **Publishing projects**: Payload into `payload/`, `publish/` created or
  symlinked per the manifest.

Then the first commits land on both repos — the accumulator's first row — and the
project is mountable.

## The operation

1. **Verify the invoker**; settle name + shape + Lore remote with the Human Lead.
2. **Create** floor, Lore, core placement, Memory skeleton, git arrangement as
   above — `python3 <dist>/core/tooling/ai-lore.py init <dir> --name <name>
   --from <dist> [--branch main] [--publishing] [--lore-remote <url>]`, where
   `<dist>` is a checkout of ai-sdlc at the wanted release tag.
3. **Verify core-containment** (the contract's fresh-install check — light
   bootstrap, ALL else in blueprint; the tool runs `check` as its last step).
4. **First paired commit**, first accumulator row (the tool lands both).
5. **State the project's shape** and hand off: orient will run on next session
   open; [`install`](./install.verb.md) offers engine wiring.

## Refusals

- Already an AI-Lore project → `upgrade` or nothing.
- A nested AI-Lore project in the ancestor chain with a clashing name → refuse;
  names disambiguate resolution.

## Related

[`install`](./install.verb.md) wires an engine ·
[`upgrade`](./upgrade.verb.md) moves versions ·
[`mount-track`](../tracks/mount-track.verb.md) starts the work.
