---
type: index
---

# Verbs

A verb is one action the AI Agent performs when asked. Each verb is one file. Read a verb when it is invoked. A verb's card says when it is invoked, what it reads, what it writes, and which mode the session must be in.

A verb's name is hyphenated, with the object first and the action second, as in spec-draft.

The Space's own verbs are files in this folder, beside the two folders below, and each has a line here. An own file with the same name as a file in `default/` is used instead of that default. No file may take the name of a file in `core/`. The verb verb-add writes a new verb.

- [core/](./core/index.md): the authoring verbs, which add to the Lore and cannot be replaced.
- [default/](./default/index.md): the verbs that ship with AI-Lore and that the Space may replace.
