---
type: corpus
term: index file
points_at:
  - lore/index.md
  - ai_readme.md
---

# Index file

## What it means

An index file, or index, is the file `index.md` that every folder in the [Lore](./lore.md) has. It has one line for each file and each subfolder in its folder, and the line says what that entry is for.

A session reads an index and not a folder. From the index it knows what exists and what each entry is for, and it opens a file only when it needs the content. `ai_readme.md` points to the index of the Lore, and the index of the Lore points to the index of each part.

The reason is cost. A session has a limited working memory, and everything it reads uses part of it. A Lore can have hundreds of files. With indexes, a session orients by reading a few short files and reads the rest when it needs it.

## Where it is kept

An index is the file `index.md` in its folder. `ai_readme.md` states the form of a line for a file and of a line for a subfolder. The file `index.md` itself is not listed, and neither is a file whose name begins with a dot. The frontmatter of an index is only `type: index`.

## What acts on it

When a file or a folder is added to the Lore, renamed or removed, the index of its folder is changed in the same piece of work. The contract lore-integrity checks, after every write to the Lore, that every folder's index lists exactly the folder's children.

## Choices recorded here

- The product document of AI-Lore 1.0 lists the term as "index". A corpus entry is in a file named after its term, and the name `index.md` is taken in every folder by the index itself. The session that wrote this entry on 2026-09-18 therefore named the term "index file" and the file `index-file.md`.
