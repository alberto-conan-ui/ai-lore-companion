# Tracks

A **track** is a persistent workspace within Memory — a branch + claim + focus pointer. Sessions mount tracks (one session per track at a time, one track per session); the **home** track is always present; child tracks branch from home and merge back. Tracks are what makes parallel sessions possible — and a track's **type** is what governs what a session may touch (there is no posture or mode layer; type is the gate).

This pillar covers the workspace primitive itself: the three track types, what a track is, how home and child tracks relate, how a session mounts a track, what a claim does, and how claims keep parallel tracks from colliding. The dashboard the registry sits in — `status.index.md` — is covered in [`status.md`](./status.md). The git arrangement that branches and merges run on top of is covered in [`git.md`](./git.md).

## Track types

What a session may touch is determined by its track type — not by any posture, mode, or dial (v0.7 removed those). There are three:

| Type | Mounted? | Has a record? | Claim | May write |
|---|---|---|---|---|
| **Trackless** | no | no | — | nothing — read-only across the project; the query / "just looking" mode |
| **Light** | no | no | journal + backlog + notepad | the journal, the [backlog](./status.md#backlog), and the notepad — nothing else |
| **Full** | **yes** (required) | yes (`tracks/<name>.track.md`) | a real, disjoint claim | everything within its claim — Payload + Memory |

- **Trackless** is read-only and leaves no trace — no journal entry, no Memory write, no record. It is what a session is before it mounts, and the right shape for a spawned session that only *queries* the project.
- **Light tracks** are **auxiliary to home**. They are *not* mounted, have *no* branch and *no* record; their journal and backlog writes land as **drift on trunk** (home's branch). A light track is **forbidden to [`ack`](./acknowledgement/ack.verb.md) or [`save-point`](./acknowledgement/save-point.verb.md)** — it cannot commit at all. A home session sees that drift and acknowledges it. This is the frictionless way to jot a backlog item or append a journal note without the mount ceremony, while the home track remains the sole commit gate.
- **Full tracks** are the workspaces this pillar's primitive describes — mounted, branched, claimed, write-capable. Only full tracks need mounting; only full tracks carry a record.

The rest of this pillar describes the **full track** primitive unless it says otherwise.

## The track primitive

One file per full track at `memory/tracks/<name>.track.md` (trackless and light tracks have no record). Every full track carries:

- **`name`** — unique among open tracks (reusable after the track is removed).
- **`branch`** — the branch name used identically on both repos, **record-authoritative**: home's is whatever the record says (`main` in most projects; `trunk` is role-language); child tracks use `track/<name>`. See [`git.md`](./git.md) for the branch arrangement.
- **`claim`** — path prefixes the track may write across Payload and Memory. Disjoint from every other open track's claim; see [Claims](#claims).
- **`focus`** (optional) — pointer to the focus this track is currently working in. A track may exist focus-less for exploratory work.
- **`mounted_by`** (optional) — the session ID of the mounted session, when one exists.

## Home and child tracks

The **home track** (`tracks/home.track.md`) is always present and sits on trunk — it has no separate branch. Home is uniform with child tracks in every other respect: same record shape, same fields, same verbs apply. (The name **`home`** replaced `master` in v0.6.1 — same role, no overload with git's old default branch name and no double-naming with the `trunk` branch the track sits on.)

**Child tracks** are created via [`spawn`](./tracks/spawn-track.verb.md) from home when contention requires it, mounted via [`mount`](./tracks/mount-track.verb.md), and disposed via [`merge`](./tracks/merge-track.verb.md) (lands work to home) or [`abandon`](./tracks/abandon-track.verb.md) (discards). Topology is **flat** — home plus N siblings, no nesting. There is no "child of a child," and there is no spawning from a child.

Tracks **outlive sessions.** A child track created in session 80 may be unmounted at close, mounted again in session 82, continue its work, and finally land in session 85. The work-in-progress lives on the track, not the session that happened to be working it.

This gives three real states for a focus: **actively worked** (focus + track + mounted session); **in-flight idle** (focus + track + no session mounted); **dormant** (focus exists, no track points at it). Which focus a track is currently working — the *active* relationship — is **derived** from open tracks and their focus pointers, not stored separately: the [`status.stack.md`](./status.md#statusstackmd--the-focus-registry) active-mark records the track name *because* a track points there, and [`mount`](./tracks/mount-track.verb.md) writes it. The focus's own **lifecycle status** (`draft` / `paused` / `in progress` / `done`) is a different fact — it is stored, on the focus's row in `status.stack.md`, and moved by the status-tree lifecycle verbs ([`status-tree.md`](./status-tree/status-tree.md)). So: *active* is derived from tracks; *status* is stored on the stack file. A focus with a track on it shows that track in its active-mark; a focus with no track has a blank active-mark and whatever lifecycle status it last reached.

## Sessions and mounting

A **session** is a runtime instance. Sessions mount tracks; tracks outlive sessions.

Mounting applies to **full tracks** (trackless writes nothing; light tracks are not mounted):

- **One session per track at a time.** Two sessions cannot mount the same full track.
- **One track per session.** A session mounts at most one track. There is no swap mid-session — close the session and reopen to switch.
- **Trackless** is a real state — a session that has not mounted any track. Trackless sessions are **read-only across the project** and write **no journal entry** on close — they leave no trace. A session that only needs to write the journal or a backlog item operates as a **light track** (see [Track types](#track-types)) rather than mounting.

### The mount flow

When a trackless session is asked to make a full-track write:

- **Home is free** → auto-mount home. The single-session common case is unchanged from prior versions; no prompt.
- **Home is taken by another session** → the session asks the Human Lead: mount an existing unmounted child track, or stay trackless and not perform this write. If no suitable child exists, one must first be **spawned from a home session** — `mount` does not create tracks.

The Human Lead may also invoke [`mount`](./tracks/mount-track.verb.md) explicitly up front — useful when the track is already open and known before any write is needed.

### Spawn, mount, merge, abandon

Four verbs manage a child track's lifecycle, and the order matters:

- **[`spawn`](./tracks/spawn-track.verb.md)** — **create** a child track. Run from **home**: the Human Lead and the session settle the new track's name, claim, and focus, then `spawn` writes the record (`tracks/<name>.track.md`) and branches `track/<name>`. It does *not* attach a session. This is how a child is born — managed from the main track, deliberately, not conjured mid-mount.
- **[`mount`](./tracks/mount-track.verb.md)** — **attach** a session to an already-opened track. The entry to write-capable state. A *different* session from the one that spawned it typically mounts a child.
- **[`merge`](./tracks/merge-track.verb.md)** — land a child track's work onto home, then remove the track record and delete the branch. HL-invoked; sessions never self-merge.
- **[`abandon`](./tracks/abandon-track.verb.md)** — discard a child track. Auto-acks any pending work first (commits survive in git's object store, recoverable), then deletes the branch and removes the track record. HL-invoked, with a confirmation prompt.

The full child lifecycle is **spawn → mount → … → merge/abandon**. Home is never spawned (it exists from `init`), merged, or abandoned; it is permanent.

## Claims

The claim is the rule that makes parallel tracks safe to coexist: each track declares which paths in Payload and Memory it may write, and claims across open tracks are **strictly disjoint by prefix**, with two carve-outs:

- **Index files (`*.index.md`)** are shared. Any open track may write to any index file. Merge conflicts in index files are the natural cost of parallelism and are resolved at merge time.
- **`status.index.md`** is the registry, shared by every track for registration, mount-state updates, drift summaries, and trail entries.

Every writing verb enforces the claim at **every write**. A path outside the mounted track's claim (and not in the carve-out) is refused; the Human Lead extends the claim, mounts a different track, or skips the write. Disjointness across all open tracks is verified at track creation and at every claim-change — the write-time check only needs the local "in my claim" comparison.

**Home's claim is focus-derived.** When home has an active focus that carries a `claim` field, home's working claim is that focus's claim — seeded onto `tracks/home.track.md` when the focus is first activated, polishable thereafter by the Human Lead on home's record without touching the focus. If the active focus has no `claim` field — the back-compat case for focuses authored before the field existed, and for exploratory focuses where the area is not yet pinned — home's claim is **implicit**: everything not currently claimed by an open child track. Child tracks always carve sub-claims that are disjoint from home's claim and from each other; while a child track is open, home may not write to the child's claimed paths.

The focus's `claim` field is set when the focus is created. The session proposes a claim derived from the focus's title, area, and any references it carries; the Human Lead confirms or edits before the focus file is written by [`add-new-focus`](./status-tree/add-new-focus.verb.md). The proposal is a starting point, not a commitment — the Human Lead can edit on the focus (the persistent default) or on home's track record (the working override) at any time.

## Save-point as consolidation

[`save-point`](./acknowledgement/save-point.verb.md) is the consolidation primitive for tracks. It is home-only, and it refuses if any child track is open. To take a save-point, every in-flight child track must be merged or abandoned first. This makes save-points represent a coherent project state — one trunk, no in-flight branches.

[`ack`](./acknowledgement/ack.verb.md) and [`ack-and-continue`](./acknowledgement/ack-and-continue.verb.md) are the everyday acknowledgements; both work on any **full** track's branches. `ack` is the deliberate pause-point variant; `ack-and-continue` is the light mid-execution variant. Save-point is the rarer "everything consolidated" moment. **Light tracks are forbidden to `ack` and `save-point`** — their journal/backlog drift on trunk is acknowledged by a home session, not by the light track itself.

## Where else tracks appear in the methodology

- [`status.md`](./status.md) — status as the registry that lists open tracks; the orient flow at session open.
- [`memory.md`](./memory.md) — tracks as a Memory component, the `track` file-schema entry.
- [`git.md`](./git.md) — the branch arrangement (`trunk` for home, `track/<name>` for children), the two-repos-together rule, drift signal mechanics per track.
- [`verbs/verbs.index.md`](./verbs.index.md) — the Tracks group (`spawn`/`mount`/`merge`/`abandon`) and how every other verb behaves with tracks.
