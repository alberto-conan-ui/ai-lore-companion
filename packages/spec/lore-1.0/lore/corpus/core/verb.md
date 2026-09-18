---
type: corpus
term: verb
points_at:
  - lore/verbs/index.md
---

# Verb

## What it means

A verb is one action that the AI Agent performs when it is asked. The Human Lead invokes a verb by its name or by describing the action. A [process](./process.md) can also invoke a verb, and a session can run a verb on itself.

The card of a verb states when the verb is invoked, what it reads, what it writes and which [mode](./mode.md) it needs. A verb that writes only to the Workbench or to the Space's GitHub Project runs in Read only.

A verb's name is hyphenated, with the object first and the action second, as in spec-draft. A process's name is one word, so the name says which of the two something is.

A default verb acts at the level of its pillar and reads the Lore of the Space for the specifics: how the plan is laid out, what a document must contain, what a payload looks like. Where the card of a default verb says "with the default layout", it says what the verb does in a Space that has not changed the defaults.

## Where it is kept

The verbs are the folder `lore/verbs/`, with one verb per file. The five authoring verbs are in `lore/verbs/core/`, the seven default verbs are in `lore/verbs/default/`, and the Space's own verbs are beside those two folders. A verb is a [card](./card.md) whose frontmatter has its name, its pillar, the mode it needs and what invokes it.

## What acts on it

The verb verb-add writes a new verb. The companion installs each verb into the AI engine as a skill of that engine.
