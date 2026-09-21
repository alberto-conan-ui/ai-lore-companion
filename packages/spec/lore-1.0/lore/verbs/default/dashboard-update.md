---
type: verb
name: dashboard-update
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# dashboard-update

Adapt the Space's dashboard layout and requested content by editing its custom JSON definition.

## When it is invoked

The Human Lead asks to change what the dashboard shows or how its components are arranged.

## What it reads and writes

Read the effective dashboard corpus entry and definition, `lore/corpus/index.md`, and the Human Lead's requested change. Read `get_dashboard_context` when available for the effective definition and diagnostics. The write targets are `lore/corpus/dashboard.json` and its index line in `lore/corpus/index.md`. Never edit the installed default in place.

## Steps

1. Call `get_dashboard_context` to confirm that this companion can read and validate structured definitions. If the tool is unavailable, prepare only a Workbench proposal and report that a compatible companion is needed. Resolve the current definition from the custom file, installed default or companion's packaged default. Make the requested change to that complete definition; an override replaces the whole definition.
2. Prepare the new JSON in the Workbench if the session is still in Read only. Use version 2, unique panel and PM-line IDs, the fixed bands and their supported panel kinds, valid panel options and finite limits. Preserve unrelated customisations.
3. Before writing Lore, call `request_writing` with the Lore target unless this session already holds it. Wait with `await_answer`. On a declined or held claim, keep the proposal in the Workbench and stop without changing Lore.
4. Run the applicable write-guard and lore-integrity checks. Write the custom JSON and maintain its index line in the same piece of work.
5. Read `get_dashboard_context` again after the change. Fix invalid-definition diagnostics; displaying a fallback does not mean the custom definition passed validation. If this companion cannot validate structured definitions, leave the change as a Workbench proposal until a compatible companion is available.
6. Run the Lore integrity check after the edits. Commit and push the custom definition and index. If this verb entered Writing, call `leave_writing`; if it was already in Writing, keep its existing claim.
7. Report the change and any need for a PM refresh. Updating the definition does not prove that new PM data has arrived.

## Contracts and refusals

The contracts write-guard and lore-integrity apply. Refuse a write outside the confirmed Lore claim, a core/default edit, executable layout content, broken component references or an unindexed definition. Do not turn a layout request into permission to change the plan or payloads.
