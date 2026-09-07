# AI-Lore

A methodology for building a **Payload** — software, a campaign, a specification, anything that benefits from persistent context — with an AI partner that remembers across sessions and challenges its own prior decisions.

The Payload is what you produce. Everything else exists to serve it: a Memory model that compounds across sessions — status tree, journal, blueprint, ledger — so session 10 starts with everything sessions 1 through 9 learned. The compound curve is the point. But compounding only works if you review what the AI writes — the AI populates the memory; your review makes it trustworthy.

AI-Lore is a **starting point**: an upstream distribution a project configures as much as it wants, not a specification it complies with.

---

## The shape

| Term        | What it is                                                          |
| ----------- | ------------------------------------------------------------------- |
| **Project** | The root directory where work happens.                              |
| **Payload** | What the Project produces. Project root minus the Lore folder.      |
| **Lore**    | The support system. Lives at `<project>/.ai-lore-<project_name>/`.  |
| **Memory**  | Lives at `<lore>/memory/`, its own git repo. The Project's record of its own thinking — status tree, tracks, journal, blueprint, notepad, save-points. |

---

## The golden rule

**Every write is confirmed to a verb; nothing writes unchosen.** Reads and conversation are free. At every write, the session names the verb that owns it and the Human Lead confirms — usually the verb already in flight, at the cost of one breath. There is no exempt surface, and the session never guesses your intent: it proposes, you choose.

The rule is total because the verb set is: every entity in Memory names its lifecycle verbs, and the Payload has its floor verb. A write with no verb is a gap in the verb set, closed through the authoring verbs — never a silent exception.

---

## How a session runs

Open an AI in your project root and say: *read `ai_readme.md`*.

1. **The floor.** The root shim points at `.ai-lore-<project>/ai_readme.md` — the golden rule, how artifacts resolve, and where to go next. Deliberately small; everything else loads when invoked.
2. **Orient.** The session reads the thin core, the focus registry (`status.stack.md`), walks the active focus's chain, checks both repos for drift, and states where the work stands.
3. **Work.** You invoke verbs — or name a process for `run-process` to drive. Each write is confirmed.
4. **Close.** The session writes its journal entry and handover, lands one paired closing commit, and unmounts.

---

## Verbs, processes, contracts

All methodology artifacts live in the Lore's `memory/blueprint/`, four branches, each with a **`core/`** subfolder holding the out-of-the-box set (never edited in place):

- **`verbs/`** — the units of *what to do*. 52 intent-named verbs in nine families — status tree (`add-new-focus`, `complete-stage`, `archive-focus`, …), buffers (`add-note`, `review-backlog`), blueprint authoring (`add-verb`, `add-contract`, `run-process`, …), payload (`update-payload`), tracks (`spawn-track`, `mount-track`, `merge-track`, …), acknowledgement (`ack`, `ack-and-continue`, `save-point`), outward (`add-parent`, `add-reference`, `publish`), lifecycle (`init`, `install`, `upgrade`, `archive-journal`), bookends (`orient`, `close-session`). Each family folder holds one context doc and lean cards.
- **`processes/`** — orchestrations of verbs, Human-Lead-started: `start-work`, `parallel-work`, `recover-session`, `groom`, `close-out`. Steps are verb references only.
- **`contracts/`** — inviolable, always-on rules: `golden-rule`, `ack-pairing`, `core-containment`, `journal-append-forward`. Stated in the floor, cited by every verb they govern, reinforced by engine hooks where checkable.
- **`tooling/`** — a registry of executables; core ships `ai-lore.py`, the mechanical half of `init` / `install` / `upgrade` / `check`.

**Customize by shadowing.** Author a same-named artifact outside `core/` and it wins. **Share through parents.** An ordered `parents:` list in `workspace.yaml` makes other projects' blueprints invocable here — resolution is by name, lowest level wins (core < parents < local), contracts accumulate. `upgrade` replaces `core/` wholesale and walks your shadows with you. The un-overridable floor is the bootstrap plus `add-verb` / `add-process` / `add-contract` / `run-process`.

---

## Memory

| Component       | Role                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| **Status tree** | One positional tree — focus → stage → phase — plus `status.stack.md`, the focus registry. Mutated only through the status-tree verbs. |
| **Tracks**      | Persistent workspaces: home is always present; child tracks branch both repos and merge back. A track's type — trackless, light, full — is the write gate. |
| **Journal**     | One file per session, append-forward, never edited. The handover is what the next session reads. |
| **Blueprint**   | Verbs, processes, contracts, tooling, and the mirror of the Payload's shape.     |
| **Notepad**     | The knowledge inbox — capture is frictionless, integration is deliberate; buffer, never destination. |
| **Save-points** | Append-only ledger. The open `next` entry accumulates a row per acknowledgement — verb, track, branch, payload hash — so any consumer resolves every cross-repo pair from one file; `save-point` seals it. |

Every Memory file carries YAML frontmatter plus a per-type body, so a program can read Memory as easily as a person can. Emptiness is a valid state everywhere.

---

## Two repositories

The Project root is the Payload repo. `<lore>/memory/` is its own repo. Every acknowledgement commits both as one unit, payload-first, and appends its row to the ledger. The working tree's dirty state is the drift signal. Memory is the project's entire durable record — give it a remote.

---

## Plain text, and installed

AI-Lore is platform-neutral plain text — complete on its own. The `install` verb projects the *resolved* artifact set into an engine: verbs and processes become skills (Claude) or slash commands (Gemini), bookends become session hooks, and the contracts an engine can enforce become hooks (Claude: journal entries cannot be edited; every write is followed by the golden-rule reminder). Installing changes how the methodology is delivered, never what it says.

---

## Getting started

```
git clone --depth 1 --branch v0.8 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore
python3 /tmp/ai-lore/process/core/tooling/ai-lore.py init <your-folder> --name <project-name> --from /tmp/ai-lore
python3 <your-folder>/.ai-lore-<project-name>/memory/blueprint/tooling/core/ai-lore.py --project <your-folder> install claude
```

Then open a session in `<your-folder>` and say *read `ai_readme.md`*.

Already on v0.7? [`process/migration-from-v0.7.md`](./process/migration-from-v0.7.md) is the playbook; `ai-lore.py migrate` is its body. Earlier versions chain through the playbooks beside it.

---

## Why this works

**Planning is cheap; discipline is the lock.** LLMs can plan in minutes. AI-Lore locks in the *discipline* — of planning, of writing, of acknowledging — not the plan.

**Knowledge compounds.** Session N loads exactly what it needs from sessions 1 through N–1, in a fraction of the tokens rediscovery would cost. The curve is back-loaded — dramatic over a multi-month effort, barely worth it for a two-session task.

**Nothing writes unchosen.** The golden rule turns "the AI did something I didn't ask for" from a fear into a catchable, attributable event.

---

## Who this is for

Experienced practitioners — people who know their domain well enough to evaluate AI output critically. The methodology does not teach you your craft; it gives you a structure for practicing it *with AI* that does not degrade over time.

> **Fair warning.** This methodology is deliberately demanding. The payoff is back-loaded: early sessions feel expensive; by session ten the compounded memory makes the AI productive immediately. Rubber-stamping the artefacts gives you all the overhead with none of the returns.

---

## Self-hosting

This repository is AI-Lore's own project. `process/` is the canonical distribution; `.ai-lore-ai-sdlc/` (gitignored, its Memory in a private repo) is the operating copy generated from it. Every release is cut through the `release` process and eats its own dogfood before it reaches `main`: see [`process/changelog/`](./process/changelog/changelog.index.md).

## Contributing

A personal methodology, shared because it might be useful. Issues and discussions are welcome; open an issue before proposing changes.

## Version

**v0.8** — September 2026. Verb discipline: the golden rule as a contract, entity-family verbs, core dissolved into blueprint with shadowing and parents, the ack ledger, `run-process`, grooming verbs, `ai-lore.py`. See [`process/changelog/v0.8.md`](./process/changelog/v0.8.md).

## License

MIT — see [LICENSE](./LICENSE).
