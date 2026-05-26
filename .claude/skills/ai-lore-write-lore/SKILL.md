---
name: ai-lore-write-lore
description: Write or update Memory — the sole path by which lore is written
---

# write-lore

`write-lore` is the sole path for writing Memory. Every Memory write goes through it — including the writes other verbs make (`close-session` writes the journal and status, `init` and `upgrade` write the Memory skeleton and migration shapes, the posture verbs update status). Routing every write through one verb is what gives it its guarantees: it owns *placement* (the right folder for each lore type), it owns *structure* (the schema'd frontmatter and body), and it carries the **three golden rules** and the **discard guard**.

A session that edits a Memory file directly has bypassed the verb — that is a defect.

## Inputs

- **Target** — the Memory node or area being written. Named by the Human Lead, or inferred from the conversation. When inferred, state the target you resolved before writing.
- **Intent** — what the change is.

## The operation

1. **Resolve placement.** Route by lore type:
   - focus → `status/focus/`
   - decomposition → `action-tree/`
   - insight → the knowledge tree at the correct branch (`reconciled` / `working` / `notepad`)
   - contract → `blueprint/contracts/`
   - process → `blueprint/processes/`
   - Payload-area description → `blueprint/mirror/<matching path>/`
   - session record → `journal/`
   - milestone → `save-points/`

   The Human Lead names *what*; you decide *where*. Never write the Payload.
2. **Walk the focus chain.** Place the target in the chain and fix any ancestry reference the write disturbs. A write that leaves a stale reference above the target has not finished.
3. **Draft the write**, then check it against the golden rules.
4. **Run the discard guard.**
5. **Write** — including the schema frontmatter for the file's `type` (see [`memory.md`](../memory.md)).

## One operation, one guard

`write-lore` is a single operation, not a menu of sub-verbs. Creating a focus, decomposing one, restructuring a node, a destructive rebuild — each is `write-lore` aimed at a named target.

The only branch is the **discard guard**, and its axis is mechanical: **does the write's own diff show existing content being removed with no equivalent landing elsewhere?**

- **No** — additive writes, and restructuring writes where content is relocated but still present, proceed ungated.
- **Yes** — stop. Show the Human Lead exactly what would be lost, and wait for explicit confirmation before writing.

A reshape that relocates content stays ungated. A rebuild that discards content trips the guard. Discarding Memory is the one write appending cannot undo — so it is the one write that is gated.

## The three golden rules

Check the drafted output against all three before the write lands. They are checks, not advice:

1. **Less is more.** Write the minimum that carries the meaning.
2. **Write to be reviewed.** The Human Lead reviews lore; write for that reader.
3. **Never duplicate.** Content that already exists in Memory or the Payload gets a reference, never a copy.
