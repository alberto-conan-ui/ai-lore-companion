# AI-Lore — The Floor

The bootstrap every AI-Lore session reads first. This file is deliberately small: it
carries the golden rule, how artifacts resolve, and where to go next. Everything else
— every verb, process, and contract — lives in the project's `blueprint/` and loads
when invoked.

AI-Lore is a methodology for building a **Payload** — software, a campaign, a
specification, anything that benefits from persistent context — with an AI partner
that remembers across sessions. AI-Lore is a **starting point**: an upstream
distribution a project configures as much as it wants, not a specification it
complies with.

## The golden rule

**Every write is confirmed to a verb; nothing writes unchosen.** Reads and
conversation are free. At every write touch, the session names the governing verb and
the Human Lead confirms — the suggestion is usually the verb already in flight, and a
standing instruction that names a verb and its cadence *is* the confirmation for the
writes it covers. There is no exempt surface: scratch, journal, registry, and engine
projections are owned by the step-lists of the verbs that make them. The session
never auto-routes intent to a verb: it surfaces the fitting verb(s) with a
recommendation and the Human Lead chooses. If nothing fits, the gap routes through
the authoring verbs.

The rule is a **contract** (`golden-rule`), one of four the core ships and every verb
cites: `golden-rule` · `ack-pairing` (every acknowledgement is a paired, ledgered
commit, payload-first) · `core-containment` (light bootstrap; everything else in
`blueprint/`; `core/` never edited in place) · `journal-append-forward` (journal
entries are never edited after writing). Contracts are stated here, cited at the
point of action, and reinforced by engine hooks where a binding can.

## Where artifacts live, and who wins

All methodology artifacts live in the Lore's `memory/blueprint/`, four branches:

- `blueprint/verbs/` — the units of *what to do*, in family folders (a family
  context doc + lean verb cards)
- `blueprint/processes/` — orchestrations of verbs, Human-Lead-started
- `blueprint/contracts/` — inviolable rules, always on
- `blueprint/tooling/` — registry of executables (core ships `ai-lore.py`, the
  mechanical half of `init` / `install` / `upgrade` / `check`)

Each branch has a **`core/`** subfolder: the out-of-the-box artifact set, placed by
`init`, replaced wholesale by `upgrade` — **never edited in place**. A project
customizes by **shadowing**: author a same-named artifact in the branch outside
`core/` and resolution picks it. Parents declared in `memory/workspace.yaml`
(`parents:` — an ordered list of paths to other AI-Lore project roots) sit between
core and local: resolution is **by name, lowest level wins** — core, then parents
(declaration order breaks ties), then project-local. Contracts **accumulate** across
the chain rather than replace, resolving lowest-wins only on direct name conflict.
`ai-lore.py resolve` prints the resolved set with provenance.

**The un-overridable floor** is this file plus four verbs — the authoring verbs
`add-verb` / `add-process` / `add-contract`, and `run-process` (the process runner).
Everything else, core included, is shadowable. The floor is what keeps a broken
customization repairable.

## Opening a session

1. Read the thin core from `blueprint/verbs/core/`: `project-structure.md` (the
   vocabulary), `status.md` (the status tree and registry), `verbs.index.md` (the map
   of operations).
2. Run the `orient` bookend (`blueprint/verbs/core/bookends/orient.verb.md`): read
   the registry, walk the chain, surface drift, state where the work stands.
3. Work. Verbs load when invoked and declare their prerequisites; the Human Lead
   invokes verbs (or names a process for `run-process` to drive); the session closes
   with `close-session`.

The manifest is `memory/workspace.yaml` (`project_name`, `core_version`, optional
`publish:` and `parents:`), covered by the Memory repo. Memory is the project's entire
durable record: it lives in its own git repo at `<lore>/memory/.git/` and deserves a
remote — settle one at `init`, or consciously not.
