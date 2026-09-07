---
type: verb
name: install
title: install — project the resolved set into an engine
family: lifecycle
track: full
invoker: human-lead
writes:
  - engine-native artifacts (.claude/skills/, hooks, or the engine's equivalents)
contracts:
  - golden-rule
updated: 2026-07-02
---

# install

Bind AI-Lore into a specific engine: project the **resolved artifact set** — core ⊕
parents ⊕ project-local, after resolution — into the engine's native forms. Run once
per engine, re-run when the resolved set changes shape wholesale.

## When to invoke

- A project meets an engine: Claude Code, Gemini, whatever binds next.
- After [`upgrade`](./upgrade.verb.md), [`add-parent`](../outward/add-parent.verb.md) /
  [`remove-parent`](../outward/remove-parent.verb.md), or any change too broad for the
  per-artifact wiring the authoring verbs already do.
- NOT required for the plain-text path — pointing any AI at `ai_readme.md` is the
  methodology in full, before and after install; installing changes delivery, never
  meaning.

## What install projects

**The resolved set, not the raw files.** Resolution runs first — by name, lowest
wins, core < parents (declaration order) < local; contracts accumulated — and what
projects is what resolves: a shadowed core verb projects the *shadow*; an inherited
parent process projects as if native. Per artifact type, per the engine's binding:

- **verb → the engine's invocable unit** (Claude: a skill per verb, trigger-loaded).
- **contract → the engine's enforcement hook** where the rule is checkable; uncheckable
  contracts stay text and citations (the layered-enforcement model — hooks reinforce,
  never carry).
- **process → the engine's composition form** (Claude: a skill that walks its verb
  references).
- **bookends → reinforced** so they cannot be skipped (Claude: SessionStart hook →
  orient), while never *depending* on the reinforcement.

**Projection rewrites links.** Copied bodies carry relative links that resolved at
the source; the projection rewrites them to resolve from the projected location (or
to absolute Lore paths) — a projected artifact with dead links is a defect of this
verb, not a cosmetic wart to document around.

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted.
2. **Resolve the set** (`ai-lore.py resolve`: core, parents in order, local;
   shadowing applied; contracts accumulated) and present the resolution summary.
3. **Project** per the engine's binding, all four artifact kinds, links rewritten —
   `python3 <lore>/memory/blueprint/tooling/core/ai-lore.py install <engine>`.
4. **Verify**: every projected artifact loads, no dead links (the tool refuses to
   report success otherwise), bookend reinforcement fires on the next open.
5. **State the binding**: engine, artifact counts, reinforcements.

## Refusals

- An unknown engine with no binding defined → the binding is authored first (that
  is Payload/methodology work, not this verb improvising one).
- Asked to project raw core, bypassing resolution → refuse; the resolved set is the
  project's truth.

## Related

[`init`](./init.verb.md) precedes ·
[`add-verb`](../blueprint/add-verb.verb.md)-family does per-artifact wiring incrementally ·
[`upgrade`](./upgrade.verb.md) and the parent verbs trigger re-runs.
