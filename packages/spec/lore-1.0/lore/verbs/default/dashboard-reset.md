---
type: verb
name: dashboard-reset
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# dashboard-reset

Remove the Space's custom dashboard JSON so the effective default is used again.

## When it is invoked

The Human Lead asks to restore the default dashboard. Their request is the instruction to remove the custom definition; this verb does not ask them to confirm the same choice again.

## What it reads and writes

Read the dashboard corpus entry, `lore/corpus/dashboard.json` when present and `lore/corpus/index.md`. Remove only the custom JSON and its index line. Keep the dashboard corpus instructions and the installed default.

## Steps

1. If the custom JSON does not exist, report that the dashboard already uses its default and stop.
2. Before changing Lore, call `request_writing` with the Lore target unless this session already holds it, then await the answer. If the claim is declined or held, change nothing.
3. Check the custom path under write-guard and lore-integrity. Remove the custom JSON and its index line together. Never remove the default definition or another custom file.
4. Read `get_dashboard_context` when available to confirm that the effective definition now resolves to the default. Report any validation problem. Run the Lore integrity check, commit and push the change.
5. If this verb entered Writing, call `leave_writing`; otherwise preserve the existing claim. Report that the default is restored and whether PM data needs refreshing.

## Contracts and refusals

The contracts write-guard and lore-integrity apply. Refuse a reset without the confirmed Lore claim. Do not delete core/default files, payload documents, PM data or unrelated customisations.
