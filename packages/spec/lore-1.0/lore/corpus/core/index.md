---
type: index
---

# Corpus: core entries

One entry per term that AI-Lore itself defines. These files are core: they are not edited in place, an upgrade of AI-Lore replaces them as a whole, and no other file in the Space may take the name of one of them.

The parts of AI-Lore:

- [ai-space.md](./ai-space.md): what an AI Space is in AI-Lore, the place where a Human Lead holds AI sessions about one subject, made of one GitHub repository with its Project and one folder on the Human Lead's computer.
- [human-lead.md](./human-lead.md): who the Human Lead is in AI-Lore, the person an AI Space belongs to and who takes its decisions, and which decisions only the Human Lead takes.
- [ai-agent.md](./ai-agent.md): what the AI Agent is in AI-Lore, the AI engine working in an AI Space, and how the Lore reaches an engine.
- [ai-session.md](./ai-session.md): what an AI Session is in AI-Lore, the Human Lead and an AI Agent working together in an AI Space for a while, and the four things that apply to every session.
- [ai-desk.md](./ai-desk.md): what the AI Desk is in AI-Lore, the local instance of an AI Space on the Human Lead's computer, what its folder holds and which records the companion keeps for it.
- [payload.md](./payload.md): what a payload is in AI-Lore, what the sessions of an AI Space produce, with its two kinds, repositories and publish areas.
- [lore.md](./lore.md): what the Lore is in AI-Lore, the git-backed folder of markdown that says how to behave in an AI Space and how its payloads are written, with its five parts and when each is read.
- [companion.md](./companion.md): what the companion is in AI-Lore, the app that manages an AI Space on a desk for the Human Lead, and what it does for a session.
- [workbench.md](./workbench.md): what the Workbench is in AI-Lore, the folder private to one desk that holds drafts, the journal and other unfinished work, and which a session can always write to.

The pillars:

- [pillar.md](./pillar.md): what a pillar is in AI-Lore, one of the five things that happen in an AI Space, and where a card names its pillar.
- [specifying.md](./specifying.md): what the pillar Specifying is in AI-Lore, writing down and agreeing what is wanted before it is built, with what is fixed about it and what serves it by default.
- [planning.md](./planning.md): what the pillar Planning is in AI-Lore, deciding what to build and in what order on the Space's GitHub Project, with what is fixed about it and what serves it by default.
- [working.md](./working.md): what the pillar Working is in AI-Lore, a session doing the work, with the three things that are fixed about it and what serves it by default.
- [producing.md](./producing.md): what the pillar Producing is in AI-Lore, the payloads and the published agreed specs, with the two things that are fixed about it and what serves it by default.
- [shaping.md](./shaping.md): what the pillar Shaping is in AI-Lore, the Human Lead deciding how an AI Space works by writing and changing the Lore, and the authoring verbs that serve it.

The layers:

- [layer.md](./layer.md): what a layer is in AI-Lore, one of the three origins of a file of the Lore, core, default and custom, and how a file's place says which layer it belongs to.
- [core.md](./core.md): what core means in AI-Lore, the layer of files that are fixed and replaced as a whole on upgrade, with the list of everything that is core.
- [default.md](./default.md): what a default is in AI-Lore, a file that ships already written and that an AI Space may replace, with the content of the default set and how a default is replaced.
- [custom.md](./custom.md): what the custom layer is in AI-Lore, the Space's own files in the Lore, which replace a default or add what no default covers.

The Lore's parts and files:

- [corpus.md](./corpus.md): what the corpus is in AI-Lore, the part of the Lore with one entry per concept that says what the words mean in an AI Space.
- [verb.md](./verb.md): what a verb is in AI-Lore, one action that the AI Agent performs when asked, with how it is named and invoked and what its card states.
- [process.md](./process.md): what a process is in AI-Lore, a sequence of verbs and decisions with declared steps and gates, and how it is started.
- [contract.md](./contract.md): what a contract is in AI-Lore, a statement of what must never happen when a session writes, with its target, its check script and its rule.
- [mirror.md](./mirror.md): what a mirror is in AI-Lore, the description of one payload's structure and content, with its skeleton and how a mirror is known to be current or out of date.
- [index-file.md](./index-file.md): what an index file is in AI-Lore, the `index.md` of every folder in the Lore with one line per entry, and why a session reads indexes first.
- [card.md](./card.md): what a card is, the frontmatter keys of each of the five kinds of card, how a card's file is named, and one example per kind.
- [frontmatter.md](./frontmatter.md): what frontmatter is, which files have it, and the exact subset of YAML it is written in.

The session's modes and targets:

- [mode.md](./mode.md): what a mode is in AI-Lore, one of the two states of a session, Read only and Writing, and where a session's mode is recorded.
- [read-only.md](./read-only.md): what Read only means in AI-Lore, the mode a session starts in, in which it changes no payload and nothing in the Lore and may still write to the Workbench and the GitHub Project.
- [writing.md](./writing.md): what Writing means in AI-Lore, the mode in which a session writes to its claimed write targets, which the Human Lead confirms in one dialog.
- [blocked.md](./blocked.md): what Blocked means in AI-Lore, the state of an unattended session in Writing that waits at a gate and keeps its write targets.
- [write-target.md](./write-target.md): what a write target is in AI-Lore, the Lore or a payload that a session names and claims before it writes, with where the claim is recorded and what it guarantees.
- [attended-and-unattended.md](./attended-and-unattended.md): what attended and unattended mean in AI-Lore, whether the Human Lead is present in a session, and what each kind of session does at a gate.
- [agents-board.md](./agents-board.md): what the Agents board is in AI-Lore, the view on the Space's GitHub Project with one issue per session that writes, with its four columns and how a collision between sessions is handled.
- [journal.md](./journal.md): what the journal is in AI-Lore, the record in the Workbench with one entry per session of a desk, to which entries are only added.
- [handover.md](./handover.md): what a handover is in AI-Lore, the end of a session's journal entry that says what was done, what is in progress and what the next session should do.

Units of work:

- [unit-of-work.md](./unit-of-work.md): what a unit of work is in AI-Lore, a piece of work on the plan that can have a spec, goes through stages and has a breakdown.
- [stage.md](./stage.md): what a stage is in AI-Lore, how far a unit of work has got, and the fixed rule that moving to the next stage needs the Human Lead's yes.
- [breakdown.md](./breakdown.md): what a breakdown is in AI-Lore, the pieces of work of a unit of work with their dependencies, drawn from the agreed spec when there is one.
- [gate.md](./gate.md): what a gate is in AI-Lore, a step of a process that needs the Human Lead's yes, with how it is answered and who records the answer.
- [acceptance-criteria.md](./acceptance-criteria.md): what acceptance criteria are in AI-Lore, the statements that a finished piece of work is reported against, drawn from the agreed spec when there is one.
- [evidence.md](./evidence.md): what evidence is in AI-Lore, what proves that a criterion is met, such as a test, the output of a command, a screenshot or the Human Lead's reading.

Specs and payloads:

- [spec.md](./spec.md): what a spec is in AI-Lore, an optional written document that says what is wanted and that the Human Lead agrees before the work is built.
- [draft.md](./draft.md): what a draft is in AI-Lore, a document in the Workbench that is being written and is not yet agreed.
- [agreed-spec.md](./agreed-spec.md): what an agreed spec is in AI-Lore, a spec that the Human Lead has declared agreed, published to a publish area and linked from its unit of work.
- [publish-area.md](./publish-area.md): what a publish area is in AI-Lore, a payload that is a local folder of documents, with the default publish area `publish/` and where publish areas are listed.
- [repository.md](./repository.md): what a repository is in AI-Lore, a payload that holds code, checked out under `repos/` and claimed whole on one branch, and how it differs from the Space repository.
