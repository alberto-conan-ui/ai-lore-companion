---
type: corpus
term: AI Agent
points_at: []
---

# AI Agent

## What it means

The AI Agent is the AI engine working in the [AI Space](./ai-space.md). AI-Lore works with any AI engine that has a command-line client, and a Space can use several engines against the same Lore.

The Lore is the only thing that AI-Lore asks an AI engine to understand. The engine has to read markdown, follow a folder of indexes, and run a script before a write where it has hooks.

## Where it is kept

The AI Agent is not kept in the Space. It learns how the Space works from the [Lore](./lore.md) and from no other place.

Where an engine has a form of its own for what the Lore contains, the companion installs the Lore into it: verbs become the engine's skills and the checks of the contracts become its hooks. Where an engine has no such form, the session reads the files of the Lore directly, and the contracts apply as rules and not as checks that the engine runs.

## What acts on it

The [companion](./companion.md) installs the Lore into the AI engine. The first build of the companion installs into Claude Code only.
