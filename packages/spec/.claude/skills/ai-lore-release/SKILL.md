---
name: ai-lore-release
description: "AI-Lore process release — Release a new core version"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/processes/release.process.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this process makes is confirmed with the Human Lead.

> **invoker:** human-lead · **contracts:** golden-rule; ack-pairing; released-on-main · **composes:** update-payload; save-point; complete-focus

# Release a new core version

The runbook for shipping a core version of AI-Lore. Invoked when a release-branch focus reaches review and the Human Lead is ready to ship.

Two truths shape this process:

- **A release is not complete when the changelog says "Released"** — it is complete when an outside session can fetch the methodology and run the migration. Push-to-main is the load-bearing step.
- **A release is not cut until a candidate has survived being eaten.** Every version ships a migration playbook; a playbook that has never been run is a guess. The **release candidate (RC)** is the version made real and migrated against a live project — this one — *before* it is allowed onto `main`. Eating the dogfood is the acceptance gate, not an afterthought.

## Lifecycle

A version moves through three changelog states:

| State | Meaning | On `main`? | Tag |
|---|---|---|---|
| **Draft** | Spec being written on the release branch. | No | none |
| **RC** | Spec complete; candidate cut for acceptance testing. | **No** — release branch only | `v<X>-rc<N>` |
| **Released** | RC survived the acceptance gate; promoted. | **Yes** | `v<X>` |

`main` is the **stable channel** — the [`released-on-main`](../../../.ai-lore-ai-sdlc/memory/blueprint/contracts/released-on-main.contract.md) contract guarantees its tip is the latest *release*. An RC must be testable without claiming stable, so it lives on the release branch at a pre-release tag (`v<X>-rc<N>`, which sorts before the final `v<X>`). **Promotion is the act of putting the validated commit on `main`** — nothing reaches `main` that has not passed the gate.

The arc: **Draft → cut RC (Part A) → acceptance gate (Part B) → promote to Released (Part C).** A failed gate loops back to a new RC (see [Failure loop](#failure-loop)); it never advances to Released and never touches `main`.

## Preflight

- Both repos clean and ack'd (orient's drift check confirms).
- The release focus is in `review`.
- `process/changelog/v<X>.md` exists and reads as final (only the Status flips are left).
- `process/migration-from-<predecessor>.md` exists and reads as final.
- The session is on the release branch (e.g. `v0.8`), not `main`; home's track record names that branch (branches are record-authoritative).

## Part A — Cut the RC

1. **Flip the changelog Status to RC.** In `process/changelog/v<X>.md`, set Status: RC. Leave Released blank. The body should already be final.
2. **Flip the index table.** In `process/changelog/changelog.index.md`, set the v<X> row's Status to `RC`. **Do not** advance the bottom-line "Current version" sentence — that still names the last *release* until promotion.
3. **Tag the candidate on the release branch.** `git tag v<X>-rc<N>` (N starts at 1) on the release-branch HEAD, both repos, and `git push origin v<X>-rc<N>`. The RC is now fetchable at its tag ref. **Do not merge to `main`.**

## Part B — Acceptance gate (eat the dogfood)

The RC is promotable only when **all** of the following pass. Run them against the RC code — fetch playbooks from the **RC tag ref** (`.../v<X>-rc<N>/process/...`), not `main`. The dogfood project (this repo, the source itself) migrates against its **local** `process/`; downstream testers fetch from the pushed RC tag.

**The gate runs on a disposable subject (F9).** Build a throwaway copy of a project at the predecessor's shape — for the dogfood, clone this repo and its Memory repo at the predecessor's tags into a scratch folder, add the vendored predecessor `process/` and manifest as they were — and migrate *that*. The subject is recreatable, so a failed gate re-runs against a fresh copy for the next RC instead of being validated by inspection.

**Run the playbook literally — corrections are findings, not fixes.** The migration must be driven by the *written* playbook, not by the runner's judgement patching it mid-flight. If a step assumes structure that isn't there, contradicts another step, or has to be reinterpreted to work, that is a **blocking finding** — the playbook is fixed and a new RC is cut, the migration is *not* hand-corrected to push through. A gate where a competent runner silently repairs the playbook tests the runner, not the playbook; a real downstream user upgrading in a fresh session has no such runner. Prefer running the dogfood in a **fresh session that has only the playbook**, so the playbook's gaps surface as failures rather than being absorbed by session context.

1. **Dogfood self-migration.** Run the migration chain on the disposable subject, from its `core_version` up to the candidate, following `migration-from-<predecessor>.md` (chaining predecessors if the subject is more than one version behind), in a fresh session that has only the playbook. It must complete clean — every step's preconditions met, no improvised workarounds.
2. **Fresh-session reopen (F10).** Open a *second* fresh session on the migrated subject **through the installed binding** (not the source tree). `orient` must load the floor and thin core, read the registry, walk the tree, and state a correct readout with no missing-file errors.
3. **Core verbs exercise.** In that same fresh session, run the version's load-bearing verbs and confirm they behave (for v0.8: `add-note` writes a note, `ack-and-continue` lands a paired commit and appends its accumulator row, `run-process` resolves a core process by name; `ai-lore.py check` passes).
   Then the source project itself migrates (self-hosting: the same playbook against local `process/`) so the release is cut from a project already living on the candidate.
4. **Downstream upgrade-by-fire.** When a real downstream project exists at the predecessor version (e.g. `ai-lore-companion`), upgrade it from the RC tag and confirm it lands. Skip only if no downstream is at the right version — and say so in the journal.

All green → the RC is **accepted**; proceed to Part C. Any red → [Failure loop](#failure-loop).

## Part C — Promote to Released

1. **Flip the changelog Status to Released.** In `process/changelog/v<X>.md`, set Status: Released and Released: today.
2. **Flip the index table and the current-version line.** In `process/changelog/changelog.index.md`, set the v<X> row to `Released` and update the bottom-line "Current version" sentence to v<X>.
3. **Regenerate the operating core and bindings (self-hosting only).** The operating `blueprint/*/core/` must be generated from canonical `/process/`: `ai-lore.py upgrade --from process` (places core, refreshes the floor, re-projects the Claude binding). `ai-lore.py check --from process` must pass. Skip on non-self-hosting projects.
4. **Save-point the release.** Invoke `save-point` to commit both repos. The ledger entry marks the version's release commit on each repo *and* records that the RC gate passed (which rc, what was tested).
5. **Tag and merge to main, both repos.** Tag the release commit `v<X>` on both repos (the Payload tag points at the commit the gate validated plus the Part C flips). Merge the release branch into `main` on both repos, then `git push origin main` plus the `v<X>` tag on both (the Lore repo's remote is private — F12). This is the step that makes the methodology reachable to outside sessions via the kickstart URL, and Memory's history safe off this disk. Home's track record returns to `branch: main`.
6. **Verify the kickstart URL resolves.** Fetch the migration playbook URL printed in `migration-from-<predecessor>.md` from `main`. A 200 with the expected body means an outside session can now upgrade.
7. **Move the release focus to Done.**

## Failure loop

If any Part B check fails:

1. **Record the failure** — a journal entry and a line in the changelog v<X> body's RC notes (what broke, on which check).
2. **Fix on the release branch** — spec, playbook, or binding. Never patch on `main`; `main` stays the last good release until the gate is green.
3. **Cut the next candidate** — `v<X>-rc<N+1>` (Part A steps 1–3, N incremented), then re-run the full gate (Part B).

Failed `rc<N>` tags remain as historical record. They are never promoted, never re-tagged `v<X>`, and never merged to `main`.

## Done when

The [`released-on-main`](../../../.ai-lore-ai-sdlc/memory/blueprint/contracts/released-on-main.contract.md) contract evaluates true: local `main` is at the release commit, and `origin/main` matches. The kickstart URL returns the expected playbook from `main`. The save-point ledger records the passing RC. Both repos are pushed.

## Why this exists

Two failures motivated this runbook:

- **v0.5** was marked Released on 2026-05-26 with the push-to-main and URL-verify steps undone. The release branch never reached `main`; the kickstart URL would have 404'd for any outside v0.4 user. The Part C ritual exists so push-to-main is one named operation, not five places-to-remember.
- **v0.6, v0.6.1, and v0.7** all shipped migration playbooks that were **never run against a real project** — not even this one. The dogfood sat at v0.5.1 Memory shape while the methodology advanced three versions, so every playbook was an untested guess. The **RC gate** (Part B) exists so a migration is *proven by eating the dogfood* before it is allowed onto `main`. A playbook that has never migrated a live project does not ship.
