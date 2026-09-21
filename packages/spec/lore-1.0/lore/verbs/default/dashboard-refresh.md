---
type: verb
name: dashboard-refresh
pillar: working
mode: read-only
invoked_by:
  - human-lead
---

# dashboard-refresh

Request a new dashboard update from the PM without changing the dashboard definition.

## When it is invoked

The Human Lead asks to refresh the dashboard, from this verb or from the dashboard Refresh button.

## What it reads and writes

Read the effective dashboard and PM corpus entries. This verb changes only temporary app state through the companion. It writes no file and does not modify the plan, claims or gates. It runs in Read only.

## Steps

1. Call `request_dashboard_update` without changing the definition or starting a Writing claim. The tool queues or joins the same update operation used by the Refresh button.
2. State whether the request was accepted or failed. Acceptance of a request is not proof that the PM has returned new data.
3. When the companion provides the result, report success only after typed data has been accepted. On failure, report the reason and that previous data was retained. Use `get_dashboard_context` to read current state when available.
4. If this companion does not expose the dashboard tools, say that the installed version does not support this workflow. Do not claim that the dashboard was refreshed.

## Contracts and refusals

The contract write-guard applies. No Writing claim is needed. Do not alter Lore or payloads, submit guessed PM data, bypass a failed refresh, or type prompt text and Enter into another session's terminal.
