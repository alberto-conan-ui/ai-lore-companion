---
type: corpus
term: AI Desk
points_at:
  - ai_readme.md
---

# AI Desk

## What it means

The AI Desk, or desk, is the local instance of an [AI Space](./ai-space.md) on the Human Lead's computer. It is the Space's folder, and the [companion](./companion.md) manages it. A Space can have more than one desk. Each desk is a clone of the same Space repository, and a colleague of the Human Lead works on a desk of their own.

## Where it is kept

The desk is the Space's folder. It holds `ai_readme.md`, the Lore, the default publish area, the checkouts of the Space's repositories under `repos/`, and the [Workbench](./workbench.md). The Lore and the default publish area are the same on every desk, because they are in the Space repository. `repos/` and the Workbench are created on each desk, and the Space repository git-ignores them.

The desk also has records of its own: the claims of its sessions, the Human Lead's answers to gates, the Human Lead's unattended tags, and the companion's cache of the Space's GitHub Project. The companion keeps these records outside the Space's folder, so that no session can write them.

## What acts on it

The companion creates the desk at setup and keeps the desk's records. The contract write-guard reads a session's mode and write targets from the desk's records before each write.

## Choices recorded here

- The product document of AI-Lore 1.0 proposes that the desk's records are kept outside the Space's folder, and the architecture document of the first build follows that proposal. The Human Lead has not yet accepted it. This entry states it as the first build does it.
- The product document says that the desk is on the Human Lead's machine. The session that wrote this entry on 2026-09-18 wrote "computer" in the definition, and uses the word "desk" in every other place where the product document says "machine".
