# AI-Lore: read this file first

This folder is an AI Space of AI-Lore 1.0. This file is the first file an AI Agent reads when a session starts here, and it is the only file whose name a session has to know. It says what AI-Lore is, what is in this folder, how the Lore is read, and which file to read next.

## What AI-Lore is

AI-Lore is a way of working with an AI partner that remembers across sessions.

An AI Space is the place where a Human Lead holds AI sessions about one subject: a product, a codebase, a client, a piece of research. A Space is one GitHub repository with one GitHub Project over its issues, and one folder on the Human Lead's machine. This folder is that folder. It is called the AI Desk, or the desk: the local instance of the Space on the Human Lead's machine, which the companion app manages. The Human Lead is the person the Space belongs to and who takes its decisions. An AI Session is the Human Lead and an AI Agent working together in the Space for a while.

The sessions of a Space produce payloads. There are two kinds of payload: repositories, which hold code, and publish areas, which hold documents.

The Lore is the folder `lore/`. It holds what every AI Agent in the Space must know: how to behave here and how the payloads are to be written. It is markdown, it is kept in git with the Space repository as its remote, and it is the same on every desk of the Space. A session learns how this Space works from the Lore and from no other place.

## What is in this folder

| Path | What it is |
|---|---|
| `ai_readme.md` | This file. |
| `lore/` | The Lore. |
| `publish/` | The default publish area. Its folder `specs/` holds one file per agreed spec. |
| `repos/` | One checkout per repository of the Space. The Space repository git-ignores this folder. |
| `workbench/` | The Workbench. It is private to this desk and the Space repository git-ignores it. `drafts/` holds documents that are not yet agreed, `journal/` holds one entry per session, and `scratch/` holds anything else a piece of work needs while it is unfinished. |

`repos/` and `workbench/` are created on each desk and are not part of the Space repository, so a fresh clone does not have them until the companion app creates them.

## The five pillars

Five things happen in a Space. They are called the pillars.

- **Specifying.** Writing down what is wanted, and agreeing it, before it is built. A spec is optional. When work has a spec, the work is checked against it.
- **Planning.** Deciding what to build, in what order, and who is building it now. The plan is on the Space's GitHub Project and not in files.
- **Working.** A session doing the work. It reads how to work from the Lore. Work that one session leaves unfinished is recorded in the Workbench, where the next session reads it.
- **Producing.** What the work produces: the payloads, written as the Lore says they must be, and the agreed specs, published to a publish area.
- **Shaping.** The Human Lead deciding how the Space works, by writing and changing the Lore.

## The three layers

The files of the Lore come from three layers. A part of the Lore can have a folder `core/`, a folder `default/`, and the Space's own files beside those two folders.

- **Core.** The files in a `core/` folder are fixed. An upgrade of AI-Lore replaces them as a whole. They are never edited in place, and no other file in the Space may take the name of a core file.
- **Default.** The files in a `default/` folder ship with AI-Lore. An upgrade replaces them as a whole. They are not edited in place. To change a default, the Human Lead writes a file with the same name beside the `default/` folder, and the Space's file is used instead of the default.
- **Own.** The files beside `core/` and `default/` are the Space's own. An upgrade does not touch them. A file here either replaces the default of the same name or adds something that no default covers.

All three layers are read in the same way.

## The index convention

Every folder in the Lore has a file `index.md`. The index has one line for each file and each subfolder in its folder, and the line says what that entry is for. The file `index.md` itself is not listed, and neither is a file whose name begins with a dot.

A line for a file has this form:

```
- [spec-draft.md](./spec-draft.md): one sentence that says what the file is for.
```

A line for a subfolder links to the subfolder's own index:

```
- [default/](./default/index.md): one sentence that says what the folder holds.
```

Read an index, not a folder. From the index you know what exists and what each entry is for. Open a file only when you need its content: a corpus entry when its word comes up, a verb when it is invoked, a process when it is run, a mirror before you write to its payload. A session has a limited working memory, and everything it reads uses part of it. Reading indexes first keeps the cost of orienting to a few short files, however many files the Lore holds.

When a file or a folder is added to the Lore, renamed or removed, the index of its folder is changed in the same piece of work.

## What holds for every session

A spec, a planned item and the processes that produce them are offered and not required. The Human Lead can ask a session for anything at any moment, and the session does it. When a spec or a planned item exists for the work, the session respects it. Four things hold for every session, whatever it is doing:

1. A session is in one of two modes, Read only and Writing. It is in Read only until it names what it will write and claims it, and the Human Lead confirms the claim. In Read only it changes no payload and nothing in the Lore. It may write to the Workbench, and it may update the Space's GitHub Project.
2. The contracts in `lore/contracts/` are checked. Where the AI engine can run a check script before or after a write, it runs it. A contract that has only a rule says so in its card.
3. A payload is written as its mirror in `lore/mirrors/` says.
4. When a session closes, it writes a journal entry in `workbench/journal/`. The entry ends with a handover: what was done, what is in progress, and what the next session should do.

## What to read next

Read `lore/index.md`. It has one line per part of the Lore and one line for `lore/space.md`, the file that names the Space's repositories and publish areas. Each part has its own index, and the index of each part lists its folders and the Space's own files.

The shape of the files in the Lore is described in two corpus entries: `lore/corpus/core/card.md` and `lore/corpus/core/frontmatter.md`. Read them before you write a file in the Lore.
