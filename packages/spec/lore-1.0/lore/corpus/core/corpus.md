---
type: corpus
term: corpus
points_at:
  - lore/corpus/index.md
---

# Corpus

## What it means

The corpus is the part of the [Lore](./lore.md) that says what the words mean in this Space. It has one entry per concept, written as a definition. A session reads an entry when it meets the word in the Lore, on the Space's GitHub Project or in the conversation.

Each entry says what the term means, where the thing it names is kept, which is the Lore, the Workbench, GitHub or the desk, and which verbs and processes act on it. Each entry also points at what it describes: a file, a section of a mirror, an issue, a page. A review of the corpus can then tell which entries describe something that has since changed or gone.

## Where it is kept

The corpus is the folder `lore/corpus/`. The entries for the terms that AI-Lore itself defines are in `lore/corpus/core/` and have the same meaning in every Space. The entries for the terms of the default Project layout and of the default way of working, such as focus and item, are in `lore/corpus/default/`. The Space's own entries are files in `lore/corpus/`, beside those two folders. One of them describes the Space itself and is written at setup. An entry is a [card](./card.md) whose frontmatter has the term and the list of what the entry points at.

## What acts on it

The verb corpus-add writes a new entry. With the Lore claimed, editing or deleting one of the Space's own entries is an ordinary write.
