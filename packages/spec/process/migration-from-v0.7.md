# Migration — v0.7 → v0.8

The playbook the [`upgrade`](./core/verbs/lifecycle/upgrade.verb.md) verb applies when
moving a project from AI-Lore v0.7 to v0.8.

v0.8 is the **verb-discipline** release: the golden rule (every write confirmed to a
verb), the verb layer regenerated as entity families, the methodology dissolved into
`blueprint/*/core/` (shadow-by-name customization, `parents:` inheritance), four
core contracts, the ack ledger accumulator, a process layer with `run-process`,
grooming verbs, the notepad replacing the knowledge tree, and the `ai-lore.py` tool.
See [`changelog/v0.8.md`](./changelog/v0.8.md).

**What does not move:** the **journal files** and the **sealed save-point entries**
are append-forward / append-only and are never touched. The status tree (v0.7 shape)
is unchanged. The two-repo arrangement, the claim model, and focus types are
unchanged.

**Multi-version hops.** This playbook assumes the project is on v0.7 *and
v0.7-shaped*. Earlier projects chain through
[`migration-from-v0.6.1.md`](./migration-from-v0.6.1.md) and its predecessors first.

## Kickstart — paste this into a fresh v0.7 session

```
You are an AI-Lore v0.7 session being asked to upgrade this project to AI-Lore v0.8.

Fetch the v0.7 → v0.8 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.7.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step.

Rules of engagement:
- Every bash command and every file move must be proposed before it runs. Wait for Human Lead approval.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

## Before starting

**Both git repositories must be at HEAD with a clean working tree.**

```
git -C <project> status
git -C <project>/.ai-lore-<project>/memory status
```

Both must report "nothing to commit, working tree clean." Confirm `core_version`
reads `"0.7"` in `<lore>/workspace.yaml` (v0.7 kept the manifest *outside* the Memory
repo; step 2 moves it). If it reads something else, this is the wrong playbook.

**Confirm the Memory is v0.7-shaped, not just stamped:**

```
test -f <lore>/memory/status/status.stack.md   # the v0.7 focus registry
test -f <lore>/memory/tracks/home.track.md      # the home record (v0.6.1+)
test -d <lore>/process                          # the vendored v0.7 methodology
```

If any is missing, the project is structurally behind its stamp — stop and run the
intervening playbooks first. Do **not** hand-patch.

## Steps

### 1. Obtain the v0.8 distribution

**Where the source comes from depends on the project:**

- **A normal downstream project** clones the version it is moving to — the **RC
  tag** during an RC (`main` still holds v0.7), the release tag after promotion:

  ```bash
  git clone --depth 1 --branch v0.8 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.8-src
  ```

  `/tmp/ai-lore-v0.8-src` is `<dist>` below (the tool accepts the checkout or its
  `process/` folder). Remove it when done.

- **The source / self-hosting project** (`ai-sdlc` itself) does not clone: its own
  `process/` is `<dist>`.

### 2. Run the mechanical migration

One command. It is the body of this playbook; every step it takes is listed below so
the run can be verified.

```bash
python3 <dist>/process/core/tooling/ai-lore.py --project <project> migrate --from <dist>
```

What it does, in order (each step idempotent):

1. **F7** — moves `<lore>/workspace.yaml` to `<lore>/memory/workspace.yaml` (inside
   the Memory repo, so version bumps leave a trace) and repoints the Manifest
   reference in `memory.index.md`.
2. Verifies `core_version` is `0.7` and the v0.7 shape is present (stops otherwise).
3. **Places core**: `blueprint/verbs/core/`, `processes/core/`, `contracts/core/`,
   `tooling/core/` from the distribution, links transformed, indexes generated;
   branch indexes gain their `core/` line; the floor is written to
   `<lore>/ai_readme.md`.
4. **Remaps every Memory link that pointed into the vendored tree** (journal files
   excepted — append-forward) to its v0.8 target in `blueprint/verbs/core/` (v0.7
   verb names mapped per the table in step 3), **removes the vendored
   `<lore>/process/` tree** (core-containment), and rewrites the root shim
   `ai_readme.md` to point at the floor.
5. **Dissolves `memory/knowledge-tree/`**: every non-index file becomes
   `memory/notepad/<slug>.note.md` (frontmatter `type: note`, `source:` the old
   path), indexed in `notepad.index.md`; the folder is removed;
   `memory.index.md` swaps the knowledge-tree line for the notepad line.
6. **Opens the accumulator** `memory/save-points/next.save-point.md` (pointing at
   the last sealed entry) and indexes it.
7. **F6** — if `tracks/home.track.md` says `branch: trunk`, records the repo's real
   branch name instead.
8. **Bumps `core_version` to `0.8`.**
9. **Re-projects** the Claude binding if `.claude/settings.json` exists (skills
   regenerated under the v0.8 names, stale v0.7 skills removed, contract hooks
   installed, `CLAUDE.md` handshake refreshed). Re-run `install gemini` by hand if
   the project uses Gemini.
10. Runs `check` and prints the result.

### 3. Verb-name mapping

Nothing in Memory references verb names structurally, but standing instructions,
notes, and habits do. The v0.7 → v0.8 names:

| v0.7 | v0.8 |
|---|---|
| `write-lore` | the entity verb for the surface: `update-focus` (focus/stage/phase bodies), `add-note`, `add-backlog-item`, `add-contract` / `update-contract`, `update-mirror`, `add-tooling` / `update-tooling`, `update-track`; Payload writes → `update-payload` (or a project verb via `add-verb`) |
| `grow` | `add-new-focus` / `add-stage` / `add-phase` |
| `advance` | `pause-focus` / `resume-focus` / `complete-focus` (Done stays Human-Lead-only); `draft → in progress` is automatic on first work |
| `archive` | `archive-focus` |
| `mount` / `spawn` / `merge` / `abandon` | `mount-track` / `spawn-track` / `merge-track` / `abandon-track` (+ new `update-track`, `release-track`) |
| `ack` / `ack-and-continue` / `save-point` | unchanged names; each now appends its accumulator row |
| `publish` / `init` / `install` / `upgrade` | unchanged names (`install-claude` → `install` with the engine as argument); new `archive-journal` |
| `orient` / `close-session` | unchanged |
| — | new: `run-process`, the grooming verbs, `add-parent` / `remove-parent`, `add-reference` / `remove-reference`, `complete-stage` / `complete-phase`, `retire-*` |

### 4. Integrate the carried-over notes

The knowledge-tree files now sit in the notepad. Run `integrate-notepad` (home,
with the Human Lead): each note routes to a contract, a mirror node, a tooling card,
a backlog item — or is killed. This is deliberately a verb, not a migration step:
routing is a judgement.

### 5. Settle the Lore remote (F12)

If `git -C <lore>/memory remote -v` is empty, decide: add a (private) remote and
push, or record a conscious local-only decision in this session's journal. Memory
is the project's entire durable record.

### 6. Commit both repos

One acknowledgeable unit, through `ack`: payload first (the root shim, `CLAUDE.md`,
`.claude/` projections, `.gitignore` if changed), the accumulator row, then the lore repo (the
manifest, `blueprint/*/core/`, the notepad, the accumulator, the removed knowledge
tree). Message e.g. *"v0.8 migration: core in blueprint, contracts, notepad,
accumulator."*

## Verify

Open a **fresh session** on the migrated project. `orient` must: read the floor, load
the thin core from `blueprint/verbs/core/`, read `status.stack.md`, walk the active
focus's chain, state the readout with no missing-file errors. Then exercise the
load-bearing verbs: `add-note` writes a note; `ack-and-continue` lands a paired
commit and appends its row; `run-process` resolves a core process by name. Finally:

```bash
python3 <lore>/memory/blueprint/tooling/core/ai-lore.py --project <project> check --from <dist>
```

must print `OK`. Take a `save-point` once verified — the milestone is "project is on
v0.8."

## What does not change

Journal files, sealed save-points, the status tree, the branch arrangement, the
claim model, focus types, the two-repo arrangement.
