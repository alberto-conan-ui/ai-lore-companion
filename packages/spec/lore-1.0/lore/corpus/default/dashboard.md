---
type: corpus
term: dashboard
points_at:
  - lore/corpus/index.md
---

# Dashboard

## What it means

The dashboard helps the Human Lead see the project's current position at a glance. It combines the companion's factual project views with a PM-authored report. The PM report is an interpretation with stated evidence, not a replacement for the plan or the Agents board.

## Default report

Use these four short sections:

- Current position: the present goal and what the available evidence says is working.
- Active work: what is being worked on now and what has recently been verified.
- Blockers: what prevents progress, who or what can unblock it, and unknowns.
- Decisions needed: the specific decisions the Human Lead needs to make; say when none are known.

Prefer concise plain text or Markdown. Name relevant issues, files or tests and distinguish observed facts from proposals. Do not invent progress, test results, dates, completion or a fresh GitHub reading. If a source cannot be read, report that limitation instead of guessing.

## Updating and customising

The Human Lead asks the PM in Sessions, for example: "You are the PM. Please update the dashboard." The PM calls report_dashboard with its report and a short basis describing the sources it actually used. The companion identifies the submitting session and the receipt time and displays the latest accepted report. The report is held only while this Space remains open; it is not a published spec or a journal.

A Space customises the report by adding lore/corpus/dashboard.md and its index line. That entry replaces this default. The PM follows the effective entry supplied at launch. Changing this definition is a Lore write and needs the Human Lead's confirmed claim; the PM does not change it while reporting.
