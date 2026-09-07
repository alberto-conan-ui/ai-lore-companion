---
name: ai-lore-upgrade
description: "AI-Lore verb upgrade — move a project to a new core"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** lifecycle · **track:** full · **invoker:** human-lead · **writes:** blueprint/*/core/ replaced wholesale; memory/workspace.yaml (core_version); migration playbook's writes, per its steps; engine re-projection · **contracts:** golden-rule; core-containment

# upgrade

Move a project to a new core version: **replace `core/` wholesale, re-validate every
shadow, run the migration playbook, bump the pin.** Human-Lead-invoked — an upgrade
changes what the project runs on.

## When to invoke

- A new AI-Lore version ships and the project wants it.
- NOT for customizing the current version (that is shadowing, no upgrade involved).

## The merge decision, made small

The customization discipline is what keeps this verb routine: **core is never edited
in place — all customization is shadow-by-name, outside `core/`.** So the new core
replaces the old **wholesale** — no textual merge, ever. What remains is the honest
part the Human Lead owns:

**Shadow re-validation.** Every local (and parent-side) shadow was written against
the *old* core. Walk each against the new one, together: the core artifact it
shadows may have absorbed the fix (retire the shadow —
[`retire-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-verb.verb.md) restores the inherited artifact), changed
shape under it (amend the shadow), or vanished/renamed (the shadow stands alone now,
or follows the rename). Each shadow's one-line *what/why* — written when it was
authored — is what makes this walk minutes, not archaeology.

**The migration playbook** (`migration-from-v<old>.md`, shipped with the new core)
carries the version-specific reshapes — Memory-structure changes, renames, new
surfaces to scaffold. It is run **literally**, step by step; a playbook defect found
mid-run is a finding to file upstream, not something to improvise past silently.

Then: `core_version` bumped in the manifest (in the Memory repo — the bump leaves a
trace), the resolved set re-projected ([`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md)'s motion), and
the core-containment check re-run. The whole upgrade lands as one paired commit with
its accumulator row — the project can point at the moment it changed versions.

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); home-mounted, no
   open children (an upgrade is a consolidation-grade act). Both repos clean.
2. **Replace `core/`** wholesale from the new version's source —
   `python3 <lore>/memory/blueprint/tooling/core/ai-lore.py upgrade --from <dist>`
   (a checkout of the new version's ai-sdlc repo at its release tag, or the local
   `process/` in the self-hosting project). The tool places core, refreshes the
   floor, prints the shadow list, bumps the pin, and re-projects installed engines.
3. **Walk the shadows** with the Human Lead; retire / amend / keep each, on the
   record.
4. **Run the migration playbook** literally (`migration-from-v<old>.md`; for
   0.7 → 0.8 the tool's `migrate` command is the playbook's mechanical body); file
   defects found.
5. **`ai-lore.py check --from <dist>`** — core-containment and the rest hold.
6. **One paired commit + accumulator row.** State the delta: version, shadows'
   fates, playbook findings.

## Refusals

- Not the Human Lead → refuse.
- Open child tracks → refuse; consolidate first.
- Core was edited in place (discipline violated upstream) → stop; that project has
  a real merge on its hands — surface it honestly before anything is replaced.

## Related

[`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md) re-projects ·
[`retire-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-verb.verb.md)-family executes shadow fates ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) often follows an upgrade.
