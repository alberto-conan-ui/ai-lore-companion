---
type: corpus
term: AI Session
points_at:
  - lore/verbs/default/session-orient.md
  - lore/verbs/default/session-close.md
---

# AI Session

## What it means

An AI Session, or session, is the Human Lead and an AI Agent working together, for a while, in an [AI Space](./ai-space.md). A session may also run without the Human Lead present, on work the Human Lead set up for it. The entry [attended and unattended](./attended-and-unattended.md) describes the two cases.

Every session that starts in a Space reads `ai_readme.md` first. A session is in one of two [modes](./mode.md), Read only and Writing, and it can move between them.

Four things apply to every session, whatever it is doing. It claims what it will write before it writes. The contracts are checked. The payloads are written as the Lore says. When it closes, it writes a journal entry that ends with a handover.

## Where it is kept

A session's mode and its claims are in the desk's records, which the companion keeps. A session that writes has an issue on the [Agents board](./agents-board.md), created when the session first enters Writing. A session that only reads has no issue. When a session closes, its entry is added to the [journal](./journal.md) in the Workbench.

## What acts on it

With the default set, the session runs the verb session-orient on itself when it starts, and the verb session-close writes its journal entry and its handover when it ends. The contract write-guard reads the session's mode and write targets before each write.
