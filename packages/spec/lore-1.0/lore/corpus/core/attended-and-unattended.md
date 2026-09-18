---
type: corpus
term: attended and unattended
points_at:
  - lore/processes/index.md
---

# Attended and unattended

## What it means

Whether the Human Lead is present is a property of a session. It is set when the session starts and is visible on the session's issue.

An attended session is one with the Human Lead present. When it reaches a [gate](./gate.md), it asks.

An unattended session is one that the companion starts on the desk, on a piece of work that the Human Lead tagged for it. It has the Lore, the checks and the Workbench as any other session has. When it reaches a gate it does not wait: it records on its issue what it would have asked, moves to [Blocked](./blocked.md), keeps its write targets and stops writing. The Human Lead answers in the companion, and the companion resumes the session or starts a new one from its handover.

A session run by a cloud service, outside a desk, is not part of AI-Lore 1.0, because it would have no Lore, no checks and no Workbench.

## Where it is kept

The card of a process says whether the process may run unattended, in the key `unattended` of its frontmatter. The Human Lead tags a piece of work from the companion, and the companion records the tag in the desk's records, so a session cannot tag its own work.

## What acts on it

The companion starts and resumes an unattended session. The same process, the same Lore and the same Agents board describe an attended session and an unattended one. None of the three default processes is for attended sessions only: specify and plan run up to their gate and stop there, and work stops at its gates.

The first build of the companion does not start unattended sessions and has no tagging, so every session in it is attended.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "attended and unattended" as one term. The session that wrote this entry on 2026-09-18 kept the two words in one entry, in a file named after the term as listed.
