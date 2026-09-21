---
type: corpus
term: dashboard
points_at:
  - lore/corpus/index.md
---

# Dashboard

## What it means

The dashboard presents this Space's current position, its work and documents to review. It combines factual companion components with typed values authored by the PM. PM interpretation does not replace the Project, desk records or files.

## Definition

The layout and requested content are JSON. The effective definition is `lore/corpus/dashboard.json` when present, otherwise `lore/corpus/default/dashboard.json`. Older Spaces without either use the companion's packaged default. Every definition file in the Lore has a line in its folder's index. A Space override replaces the complete definition; defaults are never edited in place.

Version 2 has ordered `bands`, each with an `id` and `panels`. The fixed band ids are `needs-you`, `moving` and `waiting`; a panel has an id, a kind and a source. Companion panels appear only in their own band: Needs you has next action, documents to review and the publish area; Moving has in progress, queued, dormant and done; Waiting has pull requests, live sessions, the Agents board, Space statistics and handovers. Live sessions and the Agents board remain separate panels.

The PM types are `text`, `metric` and `list`, with source `pm`. A Space may place PM panels, but the shipped default places none. Its two PM text values are lines attached to the next-action and dormant panels. Bounded panels accept a limit from 1 to 50; review documents also accepts `recentDays` from 1 to 90; supported panels declare their order. The definition accepts these panel kinds only, never executable code, HTML, CSS or arbitrary renderer names.

Malformed definitions are diagnosed. Version 1 is rejected with an `unsupported-version` diagnostic and the companion shows a valid version 2 fallback. The companion keeps the last valid definition for the open Space, or uses the default, and reports the fallback rather than silently accepting a broken override.

## Updating the data

The Refresh button and the verb `dashboard-refresh` request the same update. An ordinary agent uses `request_dashboard_update`. Concurrent requests coalesce. The companion uses the configured PM profile for a guarded transient refresh run and preserves the conversational PM session.

A PM first calls `get_dashboard_context` to read the effective definition, its hash, current request information and available Workbench evidence. It reads relevant sources, then calls `report_dashboard` with `definitionHash`, the requested typed component values and a short `basis` naming sources actually used. A transient run also supplies the request identity as the tool schema specifies. Follow the current tool schema for exact field names.

Return every PM component once. Text contains text; a metric contains a finite number or short string and an optional unit; a list contains items with IDs, labels and optional value/status text. If evidence is unavailable, return the component's explicit unavailable form and reason. Do not supply companion components or layout. Do not send the old Markdown report: it is no longer the reporting format.

The app validates IDs, types, completeness and definition hash before accepting the whole update. Invalid data leaves the previous snapshot intact. Receipt time and session identity come from the app; the PM's basis does not establish trusted freshness. Data is retained while the Space is open. Source or definition changes can make PM values outdated, and failed updates display their reason. Completing a transient run does not itself invalidate its accepted data.

## Workbench and review access

The default lists recent Markdown drafts and specs from `workbench/drafts/`, with at most ten entries from the last fourteen days. Recency uses creation time when available and an explicitly labelled modification-time fallback. Drafts are review candidates, not proof of readiness or approval. The list includes quick access to each file in the Files window.

Recent journal entries show their handovers and quick access. They record previous sessions, not live activity. Current local sessions include Read only sessions, which can produce Workbench drafts without claiming a target. Workbench evidence is private to this desk and is not published to GitHub by reporting.

## Changing the dashboard

Use `dashboard-update` to adapt the JSON and `dashboard-reset` to restore the default. Both write to the custom Lore layer and need a confirmed Lore claim. Use `dashboard-refresh` to update data in Read only. Report sources and limitations; never invent progress, verification, dates or approval.
