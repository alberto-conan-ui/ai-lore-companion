---
type: corpus
term: companion
points_at: []
---

# Companion

## What it means

The companion is the app that manages an [AI Space](./ai-space.md) in an [AI Desk](./ai-desk.md) for the Human Lead. It is the first thing that is installed, and Spaces are created and opened from it.

The companion does these things for a session:

- The companion installs the Lore into the AI engine, so that a verb can be invoked as a skill of the engine and the check of a contract runs as a hook of the engine.
- The companion shows the dialog in which the Human Lead confirms that a session enters Writing, and the dialog in which the Human Lead answers a gate. It records the claim and the answer in the desk's records.
- The companion reads the frontmatter of the cards to show the Lore, the step that a session is at, and the gates of a process.
- The companion keeps a cache of the Space's GitHub Project and shows the plan and the Agents board from it.

## Where it is kept

The companion is not part of the Space. It is an app on the Human Lead's computer. It keeps the desk's records outside the Space's folder, so that no session can write them.

## What acts on it

No verb acts on the companion. A session asks the companion for the dialog that confirms entering Writing and for the dialog of a gate, and the Human Lead answers in the companion.

## Choices recorded here

- The product document of AI-Lore 1.0 proposes that the desk's records are kept outside the Space's folder, and the architecture document of the first build follows that proposal. The Human Lead has not yet accepted it.
