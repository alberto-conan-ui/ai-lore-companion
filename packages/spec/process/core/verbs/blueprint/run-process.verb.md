---
type: verb
name: run-process
title: run-process — drive an orchestration
family: blueprint
context: ./blueprint.md
track: per the process (most need full; grooming needs home)
invoker: human-lead
floor: un-overridable
writes:
  - none of its own — every write belongs to the step-verbs it drives
contracts:
  - golden-rule
updated: 2026-07-02
---

# run-process

Drive a **process**: resolve it by name, load it, walk its steps — each step a verb,
each write confirmed. The uniform way any journey starts, and part of the
un-overridable floor: if the process-runner could be shadowed away, every inherited
journey could be silently broken.

## When to invoke

- The Human Lead names a process ("run groom", "start-work on X") — directly, or by
  picking it from the session's suggestion when their intent matches a journey
  better than a single verb.
- NOT for improvising a sequence that has no process — that is just invoking verbs
  in turn; and if the sequence recurs, [`add-process`](./add-process.verb.md) it.

## What driving means

Resolve the name through the chain (core < parents < local — a local shadow of an
inherited process wins). Load it; verify every step still resolves to a verb in the
current set (a broken reference stops the run before it starts, not at step 4).
Then walk:

- **Each step invokes its verb properly** — the step-verb's own confirmation,
  claim checks, and refusals all apply in full. A process never grants exemptions;
  authority runs contract > process > verb, and per the golden rule the run pauses
  at **every write** — a declared process makes confirmations predictable, never
  skippable.
- **Between-step judgement points** are put to the Human Lead as the process
  states them.
- **A refusing step halts the run** — the session reports which step, why, and
  what would unblock; the Human Lead decides (fix and resume, skip on the record,
  or abort). Steps already completed stand — verbs are real operations, not a
  transaction to roll back.

## The operation

1. **Verify the invoker** is the Human Lead (processes are HL-started, always).
2. **Resolve and load** the process; pre-check every step reference.
3. **Check the process's own preconditions** (home-only, track type, children
   closed — whatever its doc states).
4. **Walk the steps**, confirming per write, surfacing judgement points, halting
   honestly on refusals.
5. **Close with the process's "done looks like"** — met, or where the run stopped.

## Refusals

- Not the Human Lead → refuse.
- Unknown process name → say what the resolved catalog offers; `add-process` fills
  real gaps.
- A step no longer resolves → refuse the run; `update-process` first.

## Related

[`add-process`](./add-process.verb.md) authors what this drives ·
core journeys: [`groom`](../../processes/groom.process.md) ·
[`close-out`](../../processes/close-out.process.md) ·
[`start-work`](../../processes/start-work.process.md) ·
[`parallel-work`](../../processes/parallel-work.process.md) ·
[`recover-session`](../../processes/recover-session.process.md).
