---
type: corpus
term: AI Space
points_at:
  - lore/space.md
  - ai_readme.md
---

# AI Space

## What it means

An AI Space, or Space, is the place where a Human Lead holds AI sessions about one subject: a product, a codebase, a client, a piece of research. A Space is one GitHub repository, called the Space repository, with one GitHub Project over its issues, and one folder on the Human Lead's computer. That folder is the [AI Desk](./ai-desk.md).

Everything that the sessions of a Space produce is a [payload](./payload.md). What every AI Agent in the Space must know is written in the [Lore](./lore.md).

## Where it is kept

The Space repository holds the Lore and the default publish area, so every desk of the Space has the same ones. It also holds every issue of the Space: the units of work, their breakdown and the issues of the sessions that write. The Space's GitHub Project is where the plan is kept and where the [Agents board](./agents-board.md) is.

The file `lore/space.md` names the Space, its repository and its Project on GitHub, its repositories and its publish areas.

## What acts on it

The [companion](./companion.md) creates a Space at setup and opens it afterwards. The verb payload-add adds a payload to a Space and records it in `lore/space.md`.
