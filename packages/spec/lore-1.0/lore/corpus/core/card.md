---
type: corpus
term: card
points_at:
  - lore/corpus/index.md
  - lore/verbs/index.md
  - lore/processes/index.md
  - lore/contracts/index.md
  - lore/mirrors/index.md
---

# Card

## What it means

A card is a markdown file in one of the five parts of the Lore. It has frontmatter first and prose after it. The prose is for the session, which reads it and follows it. The frontmatter is for the companion app and for the check scripts, which need a few facts about the file without reading its prose: for example the steps of a process, or the script that checks a contract.

There are five kinds of card, one per part of the Lore: a corpus entry, a verb, a process, a contract and a mirror. The key `type` in the frontmatter says which kind a card is. The entry [frontmatter](./frontmatter.md) says how frontmatter is written.

Two kinds of file in the Lore have frontmatter and are not cards of the five kinds: an `index.md`, whose frontmatter is only `type: index`, and `lore/space.md`, whose `type` is `space`. A check script or a skeleton generator is not markdown and has no frontmatter.

## Where it is kept

Cards are kept in the Lore, in the folder of their part: `lore/corpus/`, `lore/verbs/`, `lore/processes/`, `lore/contracts/` and `lore/mirrors/`. Inside a part, a card is in `core/`, in `default/`, or beside those two folders when it is the Space's own. An own card with the same file name as a card in `default/` is used instead of that default. No card may take the file name of a card in `core/`.

## What acts on it

The verbs verb-add, process-add, contract-add and corpus-add each write one new card of their kind. The verb payload-add writes the mirror of the payload that it adds. There is no verb for changing or removing a card: with the Lore claimed, editing or deleting one of the Space's own cards is an ordinary write. The contract lore-integrity checks, after every write to the Lore, that every file's frontmatter parses, that every reference in it resolves to an existing file, and that every folder's index lists exactly its children.

## The name of a card's file

A file name is written in lower-case letters, digits and hyphens, and ends in `.md`.

- A verb, a process and a contract are in a file named after the key `name`: the verb `spec-draft` is in `spec-draft.md`.
- A corpus entry is in a file named after its term, in lower case, with each space replaced by a hyphen: the term "Human Lead" is in `human-lead.md`.
- A mirror is in a file named after its payload: the payload `publish` is described by `publish.md`.
- A check script is in the same folder as its contract's card and has the same file name with `.py` in place of `.md`.

## The keys of each kind

Every key listed for a kind is present in every card of that kind, except where the list says that a key is optional.

Two values are used by several kinds. A pillar is one of `specifying`, `planning`, `working`, `producing` and `shaping`. A path is written relative to the Space's folder, with forward slashes and with nothing before its first folder name, as in `lore/contracts/core/write-guard.py`. Paths are relative to the Space's folder and not to the card, so that a default card that is copied one folder up, to become the Space's own, keeps working without a change.

### A corpus entry

- `type`: `corpus`.
- `term`: the term, written as it is written in prose.
- `points_at`: a list of what the entry describes. An item is a path, a path followed by `#` and the name of a section, or a web address that begins with `https://`. A web address contains a colon, so it is written in double quotes. When the entry describes nothing that has a path or an address, the list is empty and is written `[]`. The list is there so that a review can tell which entries describe something that has since changed or gone.

### A verb

- `type`: `verb`.
- `name`: the verb's name, hyphenated, with the object first and the action second.
- `pillar`: the pillar that the verb serves.
- `mode`: the mode that the verb needs, `read-only` or `writing`. A verb that writes only to the Workbench or to the GitHub Project needs `read-only`.
- `invoked_by`: a list of what invokes the verb. An item is `human-lead`, `ai-session` when the session runs the verb on itself, or the name of a process.

### A process

- `type`: `process`.
- `name`: the process's name, one word.
- `pillar`: the pillar that the process serves.
- `steps`: the list of the process's steps, by name, in the order in which they run. A step's name is written in lower-case letters, digits and hyphens. The prose describes each step under the same name.
- `gates`: the list of the steps that need the Human Lead's yes. Every item is also an item of `steps`. A process with no gate has `[]`.
- `unattended`: `true` when the process may run unattended, otherwise `false`. An unattended run of a process stops at each gate until the Human Lead answers it.

### A contract

- `type`: `contract`.
- `name`: the contract's name, hyphenated.
- `pillar`: the pillar that the contract guards.
- `target`: what the contract guards. It is one of `everything`, `lore`, `journal`, `plan` and `payload`. `journal` is the journal in the Workbench, and `plan` is the Space's plan on GitHub.
- `payload`: optional, and used only when `target` is `payload`. It is the name of one payload, as it is written in `lore/space.md`. Without this key, the contract guards every payload.
- `check`: the path of the check script, or `null` when the contract has only a rule. A contract that has only a rule also says so in its prose.
- `when`: when the check runs in relation to a write to the target. It is `before`, `after`, or `both` when the script has one check before the write and one after it. It is `null` when `check` is `null`.

### A mirror

- `type`: `mirror`.
- `payload`: the name of the payload that the mirror describes, as it is written in `lore/space.md`.
- `generator`: the path of the script that generates the payload's skeleton.
- `skeleton`: the stored skeleton, as a list. It has one item per line that the generator prints, in the same order, and every item is written in double quotes. What a line looks like is decided by the generator. The mirror is current when this list is the same as the lines that the generator prints now.

## One example per kind

This entry and the entry [frontmatter](./frontmatter.md) are the examples of a corpus entry. The four examples below show the frontmatter of the other kinds in full. Their prose is cut short, and the complete cards are in the folders of their parts.

A verb:

```markdown
---
type: verb
name: spec-draft
pillar: specifying
mode: read-only
invoked_by:
  - human-lead
---

# spec-draft

The Human Lead invokes this verb to start a spec or to continue one. It writes only the draft, which is kept in the Workbench, so it runs in Read only.
```

A process:

```markdown
---
type: process
name: specify
pillar: specifying
steps:
  - open
  - draft
  - confirm
  - agree
gates:
  - confirm
unattended: true
---

# specify

This process takes an idea to an agreed spec that is published in a publish area. It has four steps. The step confirm is its one gate.
```

A contract with a check:

```markdown
---
type: contract
name: journal-append-forward
pillar: working
target: journal
check: lore/contracts/core/journal-append-forward.py
when: before
---

# journal-append-forward

The check refuses a write to a journal entry of a previous session. The rule is that a correction to a past entry is recorded in the current session's entry.
```

A contract that has only a rule has these two lines in place of the last two lines of the frontmatter above:

```yaml
check: null
when: null
```

A mirror:

```markdown
---
type: mirror
payload: publish
generator: lore/mirrors/generators/folder-skeleton.py
skeleton:
  - "specs/"
  - "specs/index.md"
---

# The publish area `publish`

This mirror describes the folder `publish/` of the Space repository. The folder `specs/` holds one file per agreed spec.
```

## Choices recorded here

The product document of AI-Lore 1.0 says what the frontmatter of each kind holds and does not name the keys. The session that wrote this entry on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The key that says which kind a card is, is `type`, the same key that `lore/space.md` uses.
- Key names are written in lower case with underscores, as in `points_at` and `invoked_by`.
- A contract has the key `name`, as a verb and a process have. The architecture document of the first build proposed it.
- A contract has the key `pillar`. The product document names the pillar that each core contract guards, and does not list the pillar among the things a contract's frontmatter holds.
- `invoked_by` is a list, because the product document describes verbs that are invoked by the Human Lead or by a process. The value `ai-session` is hyphenated so that it cannot be the name of a process, which is one word.
- A contract on one payload names it in a separate optional key, `payload`.
- A contract that has only a rule writes `check: null` and `when: null` and does not leave the two keys out.
- `when` can be `both`, because the product document gives lore-integrity one check before a write and one after it.
- The stored skeleton is a list with one item per line of the generator's output, because the frontmatter subset has no value that spans several lines.
- Paths in frontmatter are relative to the Space's folder.
- The rules for file names are this entry's, including the rule that a check script has its card's file name with `.py` in place of `.md`.
- The file name `folder-skeleton.py` and the two skeleton lines in the mirror example are placeholders of this entry. The skeleton generators decide their own file names and what a line of output looks like.
- Frontmatter has no key for a description of the card. The one sentence that says what a card is for is its line in the index of its folder, so that the sentence is written in one place. The architecture document of the first build proposed that the short description of a skill, which the companion app writes when it installs a verb or a process into an AI engine, is taken from the frontmatter. With this choice it is taken from the index line.
