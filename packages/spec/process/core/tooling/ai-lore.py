#!/usr/bin/env python3
"""ai-lore.py — the AI-Lore core tool (v0.8).

Stdlib only. One file, six commands, all of them the mechanical halves of verbs the
methodology already defines. The verb decides; this executes.

  resolve  [--json]                 the resolved artifact set: core < parents < local
  check    [--from DIST]            core-containment, dead links, citations, ledger
  install  claude|gemini            project the resolved set into an engine
  upgrade  --from DIST              replace core/ wholesale; list shadows; bump the pin
  init     DIR --name N --from DIST bootstrap a folder into an AI-Lore project
  migrate  --from DIST              the v0.7 → v0.8 Memory reshape (runs upgrade too)

Every command takes --project DIR (default: walk up from cwd to the nearest project).
A DIST is a checkout of the ai-sdlc repo, or its process/ folder.
"""
import argparse
import datetime as _dt
import json
import os
import re
import shutil
import subprocess
import sys

BRANCHES = ("verbs", "processes", "contracts", "tooling")
ARTIFACT_SUFFIX = {
    "verbs": ".verb.md",
    "processes": ".process.md",
    "contracts": ".contract.md",
    "tooling": ".tooling.md",
}
LINK_RE = re.compile(r"(\]\()([^)#\s]+)((?:#[^)]*)?\))")
TODAY = _dt.date.today().isoformat()


# ----------------------------------------------------------------------------- utils
def die(msg, code=2):
    print(f"ai-lore: {msg}", file=sys.stderr)
    sys.exit(code)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def frontmatter(text):
    """Return (dict, body). Handles scalars, lists of scalars, one nesting level."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text
    block, body = text[4:end], text[end + 5:]
    data, key, sub = {}, None, None
    for line in block.splitlines():
        if not line.strip():
            continue
        if not line.startswith(" "):
            key, _, val = line.partition(":")
            key, val, sub = key.strip(), val.strip(), None
            data[key] = val if val else None
        elif key is not None:
            s = line.strip()
            if s.startswith("- "):
                target = data if sub is None else data[key][-1] if isinstance(data[key], list) and data[key] and isinstance(data[key][-1], dict) else data
                if sub is None:
                    if not isinstance(data[key], list):
                        data[key] = []
                    item = s[2:].strip()
                    if ":" in item and not item.startswith("`"):
                        k2, _, v2 = item.partition(":")
                        data[key].append({k2.strip(): v2.strip()})
                    else:
                        data[key].append(item)
                else:
                    pass
            elif ":" in s:
                k2, _, v2 = s.partition(":")
                if isinstance(data[key], list) and data[key] and isinstance(data[key][-1], dict):
                    data[key][-1][k2.strip()] = v2.strip()
                else:
                    if not isinstance(data[key], dict):
                        data[key] = {}
                    data[key][k2.strip()] = v2.strip()
    return data, body


def yaml_scalar(v):
    return v.strip().strip('"').strip("'") if isinstance(v, str) else v


def load_workspace(path):
    d, _ = frontmatter("---\n" + read(path) + "\n---\n")
    out = {"project_name": yaml_scalar(d.get("project_name")), "core_version": yaml_scalar(d.get("core_version"))}
    parents = d.get("parents") or []
    out["parents"] = [yaml_scalar(p if isinstance(p, str) else p.get("path", "")) for p in parents]
    out["publish"] = d.get("publish") if isinstance(d.get("publish"), dict) else None
    return out


def set_core_version(ws_path, version):
    s = read(ws_path)
    s2, n = re.subn(r'(?m)^core_version:.*$', f'core_version: "{version}"', s)
    if not n:
        s2 = s.rstrip("\n") + f'\ncore_version: "{version}"\n'
    write(ws_path, s2)


def is_project_root(d):
    """A project root holds .ai-lore-<name>/ with a manifest at the v0.8 location
    (memory/workspace.yaml) or the pre-v0.8 location (<lore>/workspace.yaml)."""
    if not os.path.isdir(d):
        return False
    for name in os.listdir(d):
        if name.startswith(".ai-lore-") and (os.path.isfile(os.path.join(d, name, "memory", "workspace.yaml"))
                                            or os.path.isfile(os.path.join(d, name, "workspace.yaml"))):
            return True
    return False


def find_project(start):
    """Walk up from start to the nearest project root. Only used when --project is absent;
    an explicit --project is taken as the root itself (never walked upward — a v0.7 copy
    nested under a v0.8 project must not resolve to its ancestor)."""
    d = os.path.abspath(start)
    while True:
        if is_project_root(d):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


class Project:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        lores = [n for n in os.listdir(self.root) if n.startswith(".ai-lore-") and os.path.isdir(os.path.join(self.root, n, "memory"))]
        if len(lores) != 1:
            die(f"expected exactly one .ai-lore-<name>/ with a memory/ in {self.root}, found {lores}")
        self.lore = os.path.join(self.root, lores[0])
        self.memory = os.path.join(self.lore, "memory")
        self.blueprint = os.path.join(self.memory, "blueprint")
        self.ws_path = os.path.join(self.memory, "workspace.yaml")
        if not os.path.isfile(self.ws_path) and os.path.isfile(os.path.join(self.lore, "workspace.yaml")):
            self.ws_path = os.path.join(self.lore, "workspace.yaml")  # pre-v0.8 location; migrate moves it
        self.ws = load_workspace(self.ws_path)
        self.name = self.ws["project_name"] or lores[0][len(".ai-lore-"):]

    def rel(self, p):
        return os.path.relpath(p, self.root)


def find_dist(arg):
    a = os.path.abspath(arg)
    for cand in (a, os.path.join(a, "process")):
        if os.path.isdir(os.path.join(cand, "core")) and os.path.isfile(os.path.join(cand, "ai_readme.md")):
            return cand
    die(f"{arg} is not an AI-Lore distribution (need <dist>/core/ and <dist>/ai_readme.md; pass the ai-sdlc checkout or its process/ folder)")


def dist_version(dist):
    p = os.path.join(dist, "core", "VERSION")
    return read(p).strip() if os.path.isfile(p) else "unknown"


# ----------------------------------------------------------------------------- links
def rewrite_links(text, src_dir, dst_dir, base_root=None):
    """Re-target relative links so they resolve from dst_dir. base_root: if the resolved
    target does not exist, leave the link untouched (reported by the dead-link check)."""

    def fix(m):
        target = m.group(2)
        if target.startswith(("http://", "https://", "mailto:", "/")):
            return m.group(0)
        abs_t = os.path.normpath(os.path.join(src_dir, target))
        if not os.path.exists(abs_t):
            return m.group(0)
        return m.group(1) + os.path.relpath(abs_t, dst_dir).replace(os.sep, "/") + m.group(3)

    return LINK_RE.sub(fix, text)


def dead_links(root, skip_dirs=(".git",), only_prefix=None):
    out, total = [], 0
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in skip_dirs]
        for f in fn:
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            if only_prefix and not p.startswith(only_prefix):
                continue
            for m in LINK_RE.finditer(read(p)):
                t = m.group(2)
                if t.startswith(("http://", "https://", "mailto:", "/")):
                    continue
                total += 1
                if not os.path.exists(os.path.normpath(os.path.join(dp, t))):
                    out.append((os.path.relpath(p, root), t))
    return total, out


# ----------------------------------------------------------------------------- resolution
def artifact_name(path, branch):
    d, _ = frontmatter(read(path))
    n = d.get("name")
    if n:
        return yaml_scalar(n)
    return os.path.basename(path)[: -len(ARTIFACT_SUFFIX[branch])]


def scan_branch(folder, branch, exclude_core):
    """All artifacts under folder (recursively). exclude_core: skip folder/core/."""
    found = {}
    if not os.path.isdir(folder):
        return found
    for dp, dn, fn in os.walk(folder):
        if exclude_core and os.path.normpath(dp).startswith(os.path.normpath(os.path.join(folder, "core"))):
            continue
        dn[:] = [d for d in dn if d != ".git"]
        for f in fn:
            if f.endswith(ARTIFACT_SUFFIX[branch]):
                p = os.path.join(dp, f)
                found[artifact_name(p, branch)] = p
    return found


def resolve(project, _seen=None):
    """Returns {branch: {name: {"path", "level", "shadows": [(level, path), ...]}}} plus
    {"contracts_all": [(level, name, path)]} — contracts accumulate."""
    _seen = _seen or set()
    if project.root in _seen:
        die(f"parent cycle at {project.root}")
    _seen = _seen | {project.root}
    levels = [("core", {b: scan_branch(os.path.join(project.blueprint, b, "core"), b, False) for b in BRANCHES})]
    for i, ppath in enumerate(project.ws["parents"]):
        proot = os.path.normpath(os.path.join(project.root, ppath)) if not os.path.isabs(ppath) else ppath
        if not is_project_root(proot):
            die(f"parent {ppath} is not an AI-Lore project root")
        parent = Project(proot)
        pres = resolve(parent, _seen)
        exposed = {}
        for b in BRANCHES:
            exposed[b] = {n: v["path"] for n, v in pres[b].items() if v["level"] != "core"}
        levels.append((f"parent[{i}]:{parent.name}", exposed))
    levels.append(("local", {b: scan_branch(os.path.join(project.blueprint, b), b, True) for b in BRANCHES}))
    result = {b: {} for b in BRANCHES}
    contracts_all = []
    for level, arts in levels:
        for b in BRANCHES:
            for n, p in arts[b].items():
                prev = result[b].get(n)
                entry = {"path": p, "level": level, "shadows": (prev["shadows"] + [(prev["level"], prev["path"])]) if prev else []}
                result[b][n] = entry
                if b == "contracts":
                    contracts_all.append((level, n, p))
    result["contracts_all"] = contracts_all
    result["levels"] = [l for l, _ in levels]
    return result


def cmd_resolve(args):
    pr = Project(args.project)
    res = resolve(pr)
    if args.json:
        out = {b: {n: {"path": pr.rel(v["path"]), "level": v["level"], "shadows": [(l, pr.rel(p)) for l, p in v["shadows"]]} for n, v in res[b].items()} for b in BRANCHES}
        out["levels"] = res["levels"]
        print(json.dumps(out, indent=2))
        return
    print(f"project {pr.name} — resolution chain: {' < '.join(res['levels'])}")
    for b in BRANCHES:
        print(f"\n{b} ({len(res[b])}):")
        for n in sorted(res[b]):
            v = res[b][n]
            line = f"  {n:28s} {v['level']:22s} {pr.rel(v['path'])}"
            if v["shadows"]:
                line += "   shadows: " + ", ".join(l for l, _ in v["shadows"])
            print(line)
    if len(res["contracts_all"]) != len(res["contracts"]):
        print("\ncontracts accumulate: same-name conflicts resolved lowest-wins:")
        for n, v in res["contracts"].items():
            if v["shadows"]:
                print(f"  {n}: {v['level']} wins over {', '.join(l for l, _ in v['shadows'])}")


# ----------------------------------------------------------------------------- core placement
def place_core(project, dist, quiet=False):
    """Replace every blueprint/<branch>/core/ from dist/core/<branch>/, transforming links
    (canonical core/<branch>/… ↔ operating <branch>/core/…) and generating indexes."""
    src_core = os.path.join(dist, "core")

    def canon_to_oper(abs_canon):
        rel = os.path.relpath(abs_canon, src_core).replace(os.sep, "/")
        parts = rel.split("/")
        if parts[0] in BRANCHES:
            return os.path.join(project.blueprint, parts[0], "core", *parts[1:])
        return None

    placed = 0
    for b in BRANCHES:
        sb = os.path.join(src_core, b)
        db = os.path.join(project.blueprint, b, "core")
        if os.path.isdir(db):
            shutil.rmtree(db)
        os.makedirs(db, exist_ok=True)
        if not os.path.isdir(sb):
            continue
        for dp, dn, fn in os.walk(sb):
            dn[:] = sorted(d for d in dn if d != ".git")
            for f in sorted(fn):
                sp = os.path.join(dp, f)
                dpth = canon_to_oper(sp)
                os.makedirs(os.path.dirname(dpth), exist_ok=True)
                if f.endswith(".md"):
                    text = read(sp)

                    def fix(m, sp=sp, dpth=dpth):
                        t = m.group(2)
                        if t.startswith(("http://", "https://", "mailto:", "/")):
                            return m.group(0)
                        abs_t = os.path.normpath(os.path.join(os.path.dirname(sp), t))
                        mapped = canon_to_oper(abs_t) if abs_t.startswith(src_core) else None
                        if mapped is None:
                            return m.group(0)
                        return m.group(1) + os.path.relpath(mapped, os.path.dirname(dpth)).replace(os.sep, "/") + m.group(3)

                    write(dpth, LINK_RE.sub(fix, text))
                else:
                    shutil.copy2(sp, dpth)
                    if f.endswith(".py"):
                        os.chmod(dpth, 0o755)
                placed += 1
        generate_core_indexes(project, b)
    # the floor
    write(os.path.join(project.lore, "ai_readme.md"), read(os.path.join(dist, "ai_readme.md")))
    if not quiet:
        print(f"core placed: {placed} files from {dist} (v{dist_version(dist)}); floor refreshed")
    return placed


def one_liner(path):
    d, _ = frontmatter(read(path))
    t = yaml_scalar(d.get("title") or "")
    if " — " in t:
        return t.split(" — ", 1)[1]
    return t


def generate_core_indexes(project, branch):
    core = os.path.join(project.blueprint, branch, "core")
    title_root = f"{project.name} — Blueprint · {branch.capitalize()} · core"
    lines = [f"---\ntype: index\ntitle: {title_root}\nupdated: {TODAY}\nreferences:\n  - group: Parent\n    path: ../{branch}.index.md\n---\n\n# {title_root}\n\nThe OOB {branch} set. Replaced wholesale by `upgrade`; never edited in place; shadow by name outside `core/`.\n\n## Children\n"]
    entries = sorted(os.listdir(core)) if os.path.isdir(core) else []
    families = [e for e in entries if os.path.isdir(os.path.join(core, e))]
    files = [e for e in entries if os.path.isfile(os.path.join(core, e)) and e.endswith(".md") and e != "core.index.md"]
    others = [e for e in entries if os.path.isfile(os.path.join(core, e)) and not e.endswith(".md")]
    if branch == "verbs" and "verbs.index.md" in files:
        lines.append("- [verbs.index.md](./verbs.index.md) — the map of operations (start here).")
        files.remove("verbs.index.md")
    for fam in families:
        fam_dir = os.path.join(core, fam)
        cards = sorted(f for f in os.listdir(fam_dir) if f.endswith(ARTIFACT_SUFFIX[branch]))
        ctx = f"{fam}.md" if os.path.isfile(os.path.join(fam_dir, f"{fam}.md")) else None
        lines.append(f"- [{fam}/](./{fam}/{fam}.index.md) — {len(cards)} {branch}{' + family context' if ctx else ''}.")
        fl = [f"---\ntype: index\ntitle: {branch} core · {fam}\nupdated: {TODAY}\nreferences:\n  - group: Parent\n    path: ../core.index.md\n---\n\n# {branch} core · {fam}\n\n## Children\n"]
        if ctx:
            fl.append(f"- [{ctx}](./{ctx}) — the family context (read with any card below).")
        for c in cards:
            fl.append(f"- [{c}](./{c}) — {one_liner(os.path.join(fam_dir, c))}")
        write(os.path.join(fam_dir, f"{fam}.index.md"), "\n".join(fl) + "\n")
    for f in files:
        p = os.path.join(core, f)
        desc = one_liner(p) if f.endswith(ARTIFACT_SUFFIX[branch]) else "reference pillar (v0.7 text retained for vocabulary; the verb cards are authoritative)"
        lines.append(f"- [{f}](./{f}) — {desc}")
    for f in others:
        lines.append(f"- `{f}` — {'the core version pin' if f == 'VERSION' else 'executable (see its .tooling.md card)'}")
    write(os.path.join(core, "core.index.md"), "\n".join(lines) + "\n")


def ensure_branch_index(project, branch):
    p = os.path.join(project.blueprint, branch, f"{branch}.index.md")
    if os.path.isfile(p):
        s = read(p)
        if "core/core.index.md" not in s:
            s = s.rstrip("\n") + f"\n- [core/core.index.md](./core/core.index.md) — the OOB {branch} set (never edited in place).\n"
            write(p, s)
        return
    title = f"{project.name} — Blueprint · {branch.capitalize()}"
    write(p, f"---\ntype: index\ntitle: {title}\nupdated: {TODAY}\nreferences:\n  - group: Parent\n    path: ../blueprint.index.md\n---\n\n# {title}\n\n`core/` holds the OOB set; project-local {branch} sit in this folder, resolved by name over core (contracts accumulate).\n\n## Children\n\n- [core/core.index.md](./core/core.index.md) — the OOB {branch} set (never edited in place).\n")


# ----------------------------------------------------------------------------- check
def cmd_check(args):
    pr = Project(args.project)
    problems, notes = [], []
    # 1. the floor
    for p in (os.path.join(pr.root, "ai_readme.md"), os.path.join(pr.lore, "ai_readme.md")):
        if not os.path.isfile(p):
            problems.append(f"floor missing: {pr.rel(p)}")
    # 2. no vendored tree; nothing methodology-shaped outside blueprint
    if os.path.isdir(os.path.join(pr.lore, "process")):
        problems.append("vendored methodology tree present: <lore>/process/ (core-containment)")
    for dp, dn, fn in os.walk(pr.memory):
        dn[:] = [d for d in dn if d != ".git"]
        if dp.startswith(pr.blueprint):
            continue
        for f in fn:
            if any(f.endswith(sfx) for sfx in ARTIFACT_SUFFIX.values()):
                problems.append(f"artifact outside blueprint/: {pr.rel(os.path.join(dp, f))}")
    # 3. manifest + ledger
    if not pr.ws["core_version"]:
        problems.append("workspace.yaml: core_version missing")
    if not os.path.isfile(os.path.join(pr.memory, "save-points", "next.save-point.md")):
        problems.append("save-points/next.save-point.md (the open accumulator) missing (ack-pairing)")
    # 4. core matches the distribution it was placed from
    if args.dist:
        dist = find_dist(args.dist)
        dv = dist_version(dist)
        if dv != pr.ws["core_version"]:
            notes.append(f"pin {pr.ws['core_version']} vs distribution {dv}")
        for b in BRANCHES:
            sb, db = os.path.join(dist, "core", b), os.path.join(pr.blueprint, b, "core")
            src = {os.path.relpath(os.path.join(dp, f), sb) for dp, _, fn in os.walk(sb) for f in fn} if os.path.isdir(sb) else set()
            dst = {os.path.relpath(os.path.join(dp, f), db) for dp, _, fn in os.walk(db) for f in fn
                   if not (f == "core.index.md" or f == os.path.basename(dp) + ".index.md")} if os.path.isdir(db) else set()
            if src != dst:
                problems.append(f"{b}/core/ differs from distribution: missing {sorted(src - dst)[:5]} extra {sorted(dst - src)[:5]}")
    # 5. resolution + citations
    res = resolve(pr)
    cnames = set(res["contracts"])
    for b in ("verbs", "processes"):
        for n, v in res[b].items():
            d, _ = frontmatter(read(v["path"]))
            for c in (d.get("contracts") or []):
                c = yaml_scalar(c)
                if c not in cnames:
                    problems.append(f"{b}/{n} cites unknown contract '{c}'")
            for step in (d.get("composes") or []):
                if yaml_scalar(step) not in res["verbs"]:
                    problems.append(f"process {n} composes unknown verb '{step}'")
    # 6. dead links in blueprint, the live Memory surfaces, and projections (journal/ and
    #    status/ are history — their rot is review-focus-tree's business, not a release gate)
    for label, root in (("blueprint", pr.blueprint), ("memory", pr.memory), ("skills", os.path.join(pr.root, ".claude", "skills"))):
        if os.path.isdir(root):
            total, dead = dead_links(root, skip_dirs=(".git", "journal", "status", "blueprint") if label == "memory" else (".git",))
            if label == "skills":
                dead = [d for d in dead if d[0].startswith("ai-lore-")]
            notes.append(f"{label}: {total} links, {len(dead)} dead")
            for f, t in dead[:20]:
                problems.append(f"dead link in {label}/{f}: {t}")
    # 7. journal-append-forward, by git
    jr = os.path.join(pr.memory, "journal")
    if os.path.isdir(os.path.join(pr.memory, ".git")) and os.path.isdir(jr):
        rng = [f"{args.since}..HEAD"] if args.since else []
        out = subprocess.run(["git", "-C", pr.memory, "log", "--diff-filter=MD", "--name-only", "--pretty=format:"] + rng + ["--", "journal/live", "journal/archive"], capture_output=True, text=True).stdout
        hits = sorted({l for l in out.splitlines() if re.search(r"journal/(live|archive)/\d{4}-\d{2}-\d{2}_\d+\.md$", l)})
        if hits:
            msg = f"journal-append-forward: {len(hits)} entry file(s) modified/deleted in history{' since ' + args.since if args.since else ''}: {hits[:5]}"
            (problems if args.since else notes).append(msg + ("" if args.since else " — pass --since <last seal> to make this a failing check"))
    print(f"check {pr.name} (core_version {pr.ws['core_version']}; chain {' < '.join(res['levels'])})")
    for n in notes:
        print(f"  note: {n}")
    for p in problems:
        print(f"  FAIL: {p}")
    print("  OK — core-containment holds, links resolve, citations resolve" if not problems else f"  {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


# ----------------------------------------------------------------------------- install
HANDSHAKE_BEGIN, HANDSHAKE_END = "<!-- AI-LORE:BEGIN -->", "<!-- AI-LORE:END -->"
CLAUDE_HANDSHAKE = """<!-- AI-LORE:BEGIN -->
This project uses AI-Lore. Read `ai_readme.md` and follow its instructions.

Every write is confirmed to a verb (the golden rule). Do not use Claude Code's built-in `/plan` in this project — AI-Lore plans by growing the status tree (`add-new-focus` / `add-stage` / `add-phase`). If you invoke `/plan` anyway, treat its plan file as scratch.
<!-- AI-LORE:END -->"""
GEMINI_HANDSHAKE = """<!-- AI-LORE:BEGIN -->
This project uses AI-Lore. Read `ai_readme.md` and follow its instructions. Every write is confirmed to a verb (the golden rule).
<!-- AI-LORE:END -->"""

GUARD_PY = r'''#!/usr/bin/env python3
"""AI-Lore Claude binding — contract reinforcement hooks (generated by ai-lore.py install).
pre : PreToolUse on Write/Edit — denies edits to existing journal entries (journal-append-forward).
post: PostToolUse on Write/Edit — reminds the session of the golden rule (advisory)."""
import json, os, re, sys
mode = sys.argv[1] if len(sys.argv) > 1 else "pre"
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
path = (d.get("tool_input") or {}).get("file_path") or ""
JOURNAL = re.compile(r"/journal/(live|archive)/\d{4}-\d{2}-\d{2}_\d+\.md$")
if mode == "pre":
    if JOURNAL.search(path) and os.path.exists(path):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
              "permissionDecisionReason": "AI-Lore contract journal-append-forward: journal entries are never edited after writing. Record corrections in this session's own entry instead."}}))
else:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
          "additionalContext": "AI-Lore golden rule: this write belongs to a verb the Human Lead confirmed — name it if you have not. Nothing writes unchosen."}}))
sys.exit(0)
'''


def skill_body(pr, art_path, branch, skill_dir):
    d, body = frontmatter(read(art_path))
    name = yaml_scalar(d.get("name")) or artifact_name(art_path, branch)
    desc = one_liner(art_path) or name
    kind = "verb" if branch == "verbs" else "process"
    meta = []
    for k in ("family", "track", "invoker", "floor", "home_only"):
        if d.get(k):
            meta.append(f"**{k.replace('_', ' ')}:** {yaml_scalar(d[k])}")
    for k in ("writes", "contracts", "composes"):
        if d.get(k):
            meta.append(f"**{k}:** " + "; ".join(yaml_scalar(x) if isinstance(x, str) else json.dumps(x) for x in d[k]))
    src_dir = os.path.dirname(art_path)
    lore_rel = os.path.relpath(art_path, pr.root).replace(os.sep, "/")
    out = [f"---\nname: ai-lore-{name}\ndescription: \"AI-Lore {kind} {name} — {desc.replace(chr(34), chr(39))}\"\n---\n",
           f"> Projected from `{lore_rel}` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this {kind} makes is confirmed with the Human Lead.\n",
           "> " + " · ".join(meta) + "\n" if meta else "",
           rewrite_links(body.strip(), src_dir, skill_dir)]
    ctx = yaml_scalar(d.get("context")) if d.get("context") else None
    if ctx:
        cp = os.path.normpath(os.path.join(src_dir, ctx))
        if os.path.isfile(cp):
            out.append("\n\n---\n\n# Family context\n\n" + rewrite_links(frontmatter(read(cp))[1].strip(), os.path.dirname(cp), skill_dir))
    return "\n".join(x for x in out if x is not None) + "\n"


def merge_handshake(path, block):
    if os.path.isfile(path):
        s = read(path)
        if HANDSHAKE_BEGIN in s and HANDSHAKE_END in s:
            a, b = s.index(HANDSHAKE_BEGIN), s.index(HANDSHAKE_END) + len(HANDSHAKE_END)
            s = s[:a] + block + s[b:]
        else:
            s = s.rstrip("\n") + "\n\n" + block + "\n"
    else:
        s = block + "\n"
    write(path, s)


def merge_hooks(settings_path, wanted):
    """wanted: {event: [ {matcher, hooks:[{type, command}]} ]}. Replaces only entries whose
    command mentions ai-lore; preserves everything else."""
    cfg = json.loads(read(settings_path)) if os.path.isfile(settings_path) else {}
    hooks = cfg.setdefault("hooks", {})
    for ev, entries in wanted.items():
        kept = [e for e in hooks.get(ev, []) if not any("ai-lore" in (h.get("command") or "") for h in e.get("hooks", []))]
        hooks[ev] = kept + entries
    write(settings_path, json.dumps(cfg, indent=2) + "\n")


def cmd_install(args):
    pr = Project(args.project)
    res = resolve(pr)
    engine = args.engine
    if engine == "claude":
        skills_root = os.path.join(pr.root, ".claude", "skills")
        os.makedirs(skills_root, exist_ok=True)
        projected = set()
        for b in ("verbs", "processes"):
            for n, v in res[b].items():
                sd = os.path.join(skills_root, f"ai-lore-{n}")
                os.makedirs(sd, exist_ok=True)
                write(os.path.join(sd, "SKILL.md"), skill_body(pr, v["path"], b, sd))
                projected.add(f"ai-lore-{n}")
        stale = [d for d in os.listdir(skills_root) if d.startswith("ai-lore-") and d not in projected]
        for d in stale:
            shutil.rmtree(os.path.join(skills_root, d))
        hooks_dir = os.path.join(pr.root, ".claude", "hooks")
        guard = os.path.join(hooks_dir, "ai-lore-guard.py")
        write(guard, GUARD_PY)
        os.chmod(guard, 0o755)
        merge_hooks(os.path.join(pr.root, ".claude", "settings.json"), {
            "SessionStart": [{"matcher": "*", "hooks": [{"type": "command", "command": "echo 'Invoke the ai-lore-orient skill now.'"}]}],
            "SessionEnd": [{"matcher": "*", "hooks": [{"type": "command", "command": "echo 'Invoke the ai-lore-close-session skill now.'"}]}],
            "PreToolUse": [{"matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": "python3 .claude/hooks/ai-lore-guard.py pre"}]}],
            "PostToolUse": [{"matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": "python3 .claude/hooks/ai-lore-guard.py post"}]}],
        })
        merge_handshake(os.path.join(pr.root, "CLAUDE.md"), CLAUDE_HANDSHAKE)
        total, dead = dead_links(skills_root)
        dead = [d for d in dead if d[0].startswith("ai-lore-")]
        print(f"installed claude: {len(res['verbs'])} verbs + {len(res['processes'])} processes → .claude/skills/ ({len(stale)} stale removed); "
              f"{len(res['contracts'])} contracts → guard hook (journal-append-forward denies; golden-rule reminds); "
              f"bookends → SessionStart/SessionEnd; CLAUDE.md handshake; links {total}, dead {len(dead)}")
        for f, t in dead[:10]:
            print(f"  dead: {f}: {t}")
        sys.exit(1 if dead else 0)
    elif engine == "gemini":
        cmds = os.path.join(pr.root, ".gemini", "commands")
        os.makedirs(cmds, exist_ok=True)
        for b in ("verbs", "processes"):
            for n, v in res[b].items():
                d, _ = frontmatter(read(v["path"]))
                rel = os.path.relpath(v["path"], pr.root).replace(os.sep, "/")
                prompt = f"@{rel}"
                ctx = yaml_scalar(d.get("context")) if d.get("context") else None
                if ctx:
                    cp = os.path.normpath(os.path.join(os.path.dirname(v["path"]), ctx))
                    if os.path.isfile(cp):
                        prompt += "\\n\\n@" + os.path.relpath(cp, pr.root).replace(os.sep, "/")
                desc = one_liner(v["path"]).replace('"', "'")
                write(os.path.join(cmds, f"ai-lore-{n}.toml"), f'description = "AI-Lore {b[:-1] if b != "processes" else "process"} {n} — {desc}"\nprompt = "{prompt}"\n')
        merge_hooks(os.path.join(pr.root, ".gemini", "settings.json"), {
            "SessionStart": [{"matcher": "startup", "hooks": [{"type": "command", "command": "echo '{\"hookSpecificOutput\":{\"additionalContext\":\"Invoke the /ai-lore-orient command now.\"}}'"}]}],
            "SessionEnd": [{"matcher": "exit", "hooks": [{"type": "command", "command": "echo '{\"hookSpecificOutput\":{\"additionalContext\":\"Invoke the /ai-lore-close-session command now.\"}}'"}]}],
        })
        merge_handshake(os.path.join(pr.root, "GEMINI.md"), GEMINI_HANDSHAKE)
        print(f"installed gemini: {len(res['verbs']) + len(res['processes'])} commands → .gemini/commands/; bookend hooks; GEMINI.md handshake (contract hooks: none — Gemini has no pre-write deny; the text is the floor)")
    else:
        die(f"no binding for engine '{engine}' (claude | gemini)")


# ----------------------------------------------------------------------------- upgrade
def list_shadows(pr, res):
    rows = []
    for b in BRANCHES:
        for n, v in res[b].items():
            if v["level"] == "local" and v["shadows"]:
                _, body = frontmatter(read(v["path"]))
                why = next((l.strip() for l in body.splitlines() if l.strip() and not l.startswith("#")), "")
                rows.append((b, n, [l for l, _ in v["shadows"]], why[:120]))
    return rows


def cmd_upgrade(args):
    pr = Project(args.project)
    dist = find_dist(args.dist)
    new_v = dist_version(dist)
    old_v = pr.ws["core_version"]
    # refuse an in-place-edited core when we can tell (git-tracked core with local diffs is fine — it's the working tree)
    place_core(pr, dist)
    for b in BRANCHES:
        ensure_branch_index(pr, b)
    res = resolve(pr)
    shadows = list_shadows(pr, res)
    if shadows:
        print(f"\nshadows to re-validate against the new core ({len(shadows)}) — retire / amend / keep, with the Human Lead:")
        for b, n, over, why in shadows:
            print(f"  {b}/{n}  shadows {', '.join(over)}  — {why}")
    else:
        print("\nno local shadows — nothing to re-validate")
    set_core_version(pr.ws_path, new_v)
    print(f"core_version {old_v} → {new_v} (memory/workspace.yaml)")
    if os.path.isfile(os.path.join(pr.root, ".claude", "settings.json")) and "ai-lore" in read(os.path.join(pr.root, ".claude", "settings.json")):
        args.engine = "claude"
        try:
            cmd_install(args)
        except SystemExit:
            pass
    if os.path.isdir(os.path.join(pr.root, ".gemini", "commands")):
        args.engine = "gemini"
        cmd_install(args)
    print("\nnext: run the version's migration playbook if one applies (migrate --from DIST for 0.7 → 0.8), then `check`, then ack.")


# ----------------------------------------------------------------------------- init
def cmd_init(args):
    root = os.path.abspath(args.dir)
    name = args.name
    if not re.match(r"^[a-zA-Z0-9_][a-zA-Z0-9_-]*$", name):
        die("project name must match ^[a-zA-Z0-9_][a-zA-Z0-9_-]*$")
    if find_project(root) == root:
        die("already an AI-Lore project — use upgrade")
    dist = find_dist(args.dist)
    version = dist_version(dist)
    lore = os.path.join(root, f".ai-lore-{name}")
    mem = os.path.join(lore, "memory")
    os.makedirs(mem, exist_ok=True)
    write(os.path.join(root, "ai_readme.md"), f"# {name}\n\nThis project uses AI-Lore (v{version}). Read `.ai-lore-{name}/ai_readme.md` — the floor — and follow its instructions.\n")
    gi = os.path.join(root, ".gitignore")
    entries = [f".ai-lore-{name}/", "publish/", "out/"]
    existing = read(gi) if os.path.isfile(gi) else ""
    write(gi, (existing.rstrip("\n") + "\n" if existing else "") + "\n# AI-Lore\n" + "\n".join(e for e in entries if e not in existing) + "\n")
    os.makedirs(os.path.join(root, "out"), exist_ok=True)
    if args.publishing:
        os.makedirs(os.path.join(root, "payload"), exist_ok=True)
        os.makedirs(os.path.join(root, "publish"), exist_ok=True)
    ws = f'project_name: {name}\ncore_version: "{version}"\n'
    if args.publishing:
        ws += "\npublish:\n  path: ./publish\n"
    write(os.path.join(mem, "workspace.yaml"), ws)
    write(os.path.join(mem, ".gitignore"), ".DS_Store\nThumbs.db\n*.swp\n*~\n")
    pr = Project(root)
    # blueprint
    for b in BRANCHES:
        os.makedirs(os.path.join(pr.blueprint, b), exist_ok=True)
    place_core(pr, dist, quiet=True)
    for b in BRANCHES:
        ensure_branch_index(pr, b)
    write(os.path.join(pr.blueprint, "mirror", "mirror.index.md"), idx(f"{name} — Blueprint · Mirror", "../blueprint.index.md", "Description of the Payload's shape. Emptiness is valid."))
    write(os.path.join(pr.blueprint, "blueprint.index.md"), idx(f"{name} — Blueprint", "../memory.index.md", "Authored, shareable artifacts: verbs, processes, contracts (each with a `core/` OOB set, never edited in place — shadow by name), plus tooling and the mirror.",
         ["[verbs/verbs.index.md](./verbs/verbs.index.md) — the units of what to do.", "[processes/processes.index.md](./processes/processes.index.md) — orchestrations of verbs.", "[contracts/contracts.index.md](./contracts/contracts.index.md) — inviolable rules; accumulate.", "[tooling/tooling.index.md](./tooling/tooling.index.md) — registry of executables (core ships `ai-lore.py`).", "[mirror/mirror.index.md](./mirror/mirror.index.md) — the Payload's shape."]))
    # status tree
    st = os.path.join(mem, "status")
    write(os.path.join(st, "status.index.md"), idx(f"{name} — Status", "../memory.index.md", "Root of the status tree — pure wiring.", ["[status.stack.md](./status.stack.md) — the focus registry.", "[backlog/backlog.index.md](./backlog/backlog.index.md) — pre-focus to-dos.", "[archive/archive.index.md](./archive/archive.index.md) — finished focuses."]))
    write(os.path.join(st, "status.stack.md"), f"---\ntype: status-stack\ntitle: {name} — Focus registry\nupdated: {TODAY}\nreferences:\n  - group: Parent\n    path: ./status.index.md\n---\n\n# {name} — Focus registry\n\nOne row per focus: link + status (`draft` / `paused` / `in progress` / `done`) + active-mark (the track working it).\n\n| Focus | Status | Active |\n|---|---|---|\n")
    write(os.path.join(st, "backlog", "backlog.index.md"), idx(f"{name} — Backlog", "../status.index.md", "Pre-focus work items. Light tracks may write here."))
    write(os.path.join(st, "archive", "archive.index.md"), idx(f"{name} — Focus archive", "../status.index.md", "Finished focuses, relocated by `archive-focus`."))
    # tracks
    branch = args.branch
    write(os.path.join(mem, "tracks", "tracks.index.md"), idx(f"{name} — Tracks", "../memory.index.md", "Full-track records.", ["[home.track.md](./home.track.md) — the always-present home track."]))
    write(os.path.join(mem, "tracks", "home.track.md"), f"---\ntype: track\ntitle: {name} — home\nname: home\nbranch: {branch}\nclaim:\nfocus:\nmounted_by:\nreferences:\n  - group: Parent\n    path: ./tracks.index.md\n---\n\n# {name} — home\n\nThe always-present home track. Its branch name is record-authoritative (`{branch}` on both repos). With no child tracks open, home claims everything.\n")
    # journal, notepad, save-points
    write(os.path.join(mem, "journal", "journal.index.md"), idx(f"{name} — Journal", "../memory.index.md", "Session records and handovers; append-forward.", ["[live/live.index.md](./live/live.index.md) — current session files (the journal trail)."]))
    write(os.path.join(mem, "journal", "live", "live.index.md"), idx(f"{name} — Journal · live", "../journal.index.md", "Newest first."))
    write(os.path.join(mem, "notepad", "notepad.index.md"), idx(f"{name} — Notepad", "../memory.index.md", "The knowledge inbox — buffer, never destination. Light tracks may write here."))
    write(os.path.join(mem, "save-points", "save-points.index.md"), idx(f"{name} — Save-points", "../memory.index.md", "Append-only ledger of milestones; `next.save-point.md` is the open accumulator every ack-family commit appends to.", ["[next.save-point.md](./next.save-point.md) — the open accumulator."]))
    write(os.path.join(mem, "save-points", "next.save-point.md"), accumulator_text())
    write(os.path.join(mem, "memory.index.md"), idx(f"{name} — Memory", None, f"Memory for {name}. Sessions read `status/status.index.md` first.",
         ["[status/status.index.md](./status/status.index.md) — the status tree.", "[tracks/tracks.index.md](./tracks/tracks.index.md) — track records.", "[journal/journal.index.md](./journal/journal.index.md) — continuity.", "[blueprint/blueprint.index.md](./blueprint/blueprint.index.md) — verbs, processes, contracts, tooling, mirror.", "[save-points/save-points.index.md](./save-points/save-points.index.md) — the ledger.", "[notepad/notepad.index.md](./notepad/notepad.index.md) — the knowledge inbox."], manifest=True))
    write(os.path.join(lore, "references", "references.index.md"), idx(f"{name} — References", None, "Consult-only pointers to other projects (`add-reference`). Parents are declared in `memory/workspace.yaml`."))
    # git
    if not args.no_git:
        for repo in (root, mem):
            if not os.path.isdir(os.path.join(repo, ".git")):
                subprocess.run(["git", "init", "-q", "-b", branch, repo], check=True)
        if args.lore_remote:
            subprocess.run(["git", "-C", mem, "remote", "add", "origin", args.lore_remote], check=True)
        subprocess.run(["git", "-C", root, "add", "-A"], check=True)
        subprocess.run(["git", "-C", root, "commit", "-q", "-m", f"init: AI-Lore v{version} project {name}"], check=True)
        ph = subprocess.run(["git", "-C", root, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
        append_row(pr, "init", "home", branch, ph, f"init: AI-Lore v{version} project {name}")
        subprocess.run(["git", "-C", mem, "add", "-A"], check=True)
        subprocess.run(["git", "-C", mem, "commit", "-q", "-m", f"init: AI-Lore v{version} memory for {name}"], check=True)
    print(f"initialized {name} at {root} (AI-Lore v{version}; home on `{branch}`; Lore remote: {args.lore_remote or 'none — local-only, decide consciously and add one with git -C <lore>/memory remote add origin <url>'})")
    args.dist = None
    args.since = None
    args.project = root
    cmd_check(args)


def idx(title, parent, blurb, children=None, manifest=False):
    refs = ""
    if parent:
        refs = f"references:\n  - group: Parent\n    path: {parent}\n"
    if manifest:
        refs = "references:\n  - group: Manifest\n    path: ./workspace.yaml\n"
    kids = "\n".join(f"- {c}" for c in (children or [])) or "(empty)"
    return f"---\ntype: index\ntitle: {title}\nupdated: {TODAY}\n{refs}---\n\n# {title}\n\n{blurb}\n\n## Children\n\n{kids}\n"


def accumulator_text(previous=None):
    prev = f"Previous seal: [{previous}](./{previous}.save-point.md).\n" if previous else ""
    return f"---\ntype: save-point\ntitle: next — open accumulator\nstatus: open\nupdated: {TODAY}\nreferences:\n  - group: Parent\n    path: ./save-points.index.md\n---\n\n# next — open accumulator\n\nThe open next-save-point entry (the ack ledger). Every ack-family commit appends one row as it lands: payload commits first, the row pins the payload hash, the row's own lore commit is self-identifying. Sealed into a dated entry by `save-point`.\n{prev}\n| Date | Verb | Track | Branch | Payload | Summary |\n|---|---|---|---|---|---|\n"


def append_row(pr, verb, track, branch, payload_hash, summary):
    p = os.path.join(pr.memory, "save-points", "next.save-point.md")
    s = read(p) if os.path.isfile(p) else accumulator_text()
    write(p, s.rstrip("\n") + f"\n| {TODAY} | {verb} | {track} | {branch} | {payload_hash or '—'} | {summary} |\n")


# ----------------------------------------------------------------------------- migrate 0.7 → 0.8

# v0.7 verb names → v0.8 artifact names (for link remapping at migration)
V07_VERB_MAP = {
    "grow": "add-new-focus", "advance": "status-tree", "archive": "archive-focus",
    "mount": "mount-track", "spawn": "spawn-track", "merge": "merge-track", "abandon": "abandon-track",
    "write-lore": "update-focus", "install-claude": "install", "install-gemini": "install",
}


def remap_vendored_links(pr, vend):
    """Rewrite Memory links that point into the vendored <lore>/process/ tree (v0.7) to their
    v0.8 targets in blueprint/verbs/core/. Journal files are never touched (append-forward)."""
    core = os.path.join(pr.blueprint, "verbs", "core")
    by_name = {}
    for dp, _, fn in os.walk(core):
        for f in fn:
            if f.endswith(".verb.md"):
                by_name.setdefault(f[:-len(".verb.md")], os.path.join(dp, f))
            elif f.endswith(".md") and not f.endswith(".index.md"):
                by_name.setdefault(f[:-3], os.path.join(dp, f))
    rewritten = 0
    for dp, dn, fn in os.walk(pr.memory):
        dn[:] = [d for d in dn if d not in (".git", "journal", "blueprint")]
        for f in fn:
            if not f.endswith(".md"):
                continue
            p = os.path.join(dp, f)
            text = read(p)

            def fix(m, dp=dp):
                t = m.group(2)
                if t.startswith(("http://", "https://", "mailto:", "/")):
                    return m.group(0)
                abs_t = os.path.normpath(os.path.join(dp, t))
                if not abs_t.startswith(vend + os.sep):
                    return m.group(0)
                rel = os.path.relpath(abs_t, vend).replace(os.sep, "/")
                if rel == "ai_readme.md":
                    target = os.path.join(pr.lore, "ai_readme.md")
                elif rel.startswith("verbs/"):
                    name = os.path.basename(rel)[:-3]
                    target = by_name.get(V07_VERB_MAP.get(name, name))
                else:
                    target = os.path.join(core, rel)
                if not target or not os.path.exists(target):
                    return m.group(0)
                return m.group(1) + os.path.relpath(target, dp).replace(os.sep, "/") + m.group(3)

            new = LINK_RE.sub(fix, text)
            if new != text:
                write(p, new)
                rewritten += 1
    return rewritten

def cmd_migrate(args):
    root = os.path.abspath(args.project)
    if not is_project_root(root):
        die(f"{root} is not an AI-Lore project root (no .ai-lore-<name>/ with a workspace.yaml at either the v0.7 or v0.8 location)")
    lores = [n for n in os.listdir(root) if n.startswith(".ai-lore-")]
    lore = os.path.join(root, lores[0])
    mem = os.path.join(lore, "memory")
    # F7: the manifest moves into the Memory repo
    old_ws, new_ws = os.path.join(lore, "workspace.yaml"), os.path.join(mem, "workspace.yaml")
    if os.path.isfile(old_ws) and not os.path.isfile(new_ws):
        shutil.move(old_ws, new_ws)
        mi0 = os.path.join(mem, "memory.index.md")
        if os.path.isfile(mi0):
            write(mi0, read(mi0).replace("path: ../workspace.yaml", "path: ./workspace.yaml"))
        print("moved workspace.yaml into memory/ (F7); memory.index.md manifest reference repointed")
    pr = Project(root)
    if pr.ws["core_version"] not in ("0.7",):
        die(f"this playbook migrates 0.7 → 0.8; core_version is {pr.ws['core_version']}")
    for must in ("status/status.stack.md", "tracks/home.track.md"):
        if not os.path.isfile(os.path.join(mem, must)):
            die(f"Memory is not v0.7-shaped: {must} missing — run the earlier playbooks first (structure behind its stamp; do not hand-patch)")
    dist = find_dist(args.dist)
    # 1. core placement + floor (the upgrade motion) — before the vendored tree goes
    for b in BRANCHES:
        os.makedirs(os.path.join(pr.blueprint, b), exist_ok=True)
    place_core(pr, dist)
    for b in BRANCHES:
        ensure_branch_index(pr, b)
    bp_idx = os.path.join(pr.blueprint, "blueprint.index.md")
    if os.path.isfile(bp_idx):
        s = read(bp_idx)
        if "verbs/verbs.index.md" not in s:
            s = s.rstrip("\n") + "\n- [verbs/verbs.index.md](./verbs/verbs.index.md) — the units of what to do; `core/` holds the OOB set.\n"
            write(bp_idx, s)
    # 2. Memory links into the vendored tree are remapped, then the tree retires; the root shim points at the floor
    vend = os.path.join(lore, "process")
    if os.path.isdir(vend):
        n = remap_vendored_links(pr, vend)
        shutil.rmtree(vend)
        print(f"remapped links into the vendored tree in {n} Memory file(s); removed vendored <lore>/process/ (core-containment)")
    write(os.path.join(root, "ai_readme.md"), f"# {pr.name}\n\nThis project uses AI-Lore (v{dist_version(dist)}). Read `.ai-lore-{pr.name}/ai_readme.md` — the floor — and follow its instructions.\n")
    # 3. knowledge-tree dissolves into the notepad
    kt = os.path.join(mem, "knowledge-tree")
    np_dir = os.path.join(mem, "notepad")
    os.makedirs(np_dir, exist_ok=True)
    np_idx = os.path.join(np_dir, "notepad.index.md")
    if not os.path.isfile(np_idx):
        write(np_idx, idx(f"{pr.name} — Notepad", "../memory.index.md", "The knowledge inbox — buffer, never destination. Notes below were carried over from the retired knowledge tree at the v0.8 migration; route each through `integrate-notepad`."))
    moved = 0
    if os.path.isdir(kt):
        for dp, dn, fn in os.walk(kt):
            for f in sorted(fn):
                if f.endswith(".index.md") or not f.endswith(".md"):
                    continue
                src = os.path.join(dp, f)
                rel = os.path.relpath(src, kt).replace(os.sep, "/")
                slug = re.sub(r"\.(spec|kt|note)?\.?md$", "", f).replace(".", "-")
                d, body = frontmatter(read(src))
                title = yaml_scalar(d.get("title") or slug)
                dst = os.path.join(np_dir, f"{slug}.note.md")
                write(dst, f"---\ntype: note\ntitle: {title}\nupdated: {TODAY}\nsource: knowledge-tree/{rel}\nreferences:\n  - group: Parent\n    path: ./notepad.index.md\n---\n\n> Carried over from the knowledge tree (`{rel}`) at the v0.8 migration. Route or kill via `integrate-notepad`.\n\n" + body.lstrip("\n"))
                s = read(np_idx).rstrip("\n")
                if "(empty" in s:
                    s = s.replace("(empty)", "").replace("(empty — drained)", "").rstrip("\n")
                if s.endswith("## Children"):
                    s += "\n"
                write(np_idx, s + f"\n- [{slug}.note.md](./{slug}.note.md) — from `knowledge-tree/{rel}`; awaiting integrate-notepad.\n")
                moved += 1
        shutil.rmtree(kt)
        print(f"knowledge-tree/ dissolved: {moved} file(s) → notepad/ as notes; folder removed")
    mi = os.path.join(mem, "memory.index.md")
    if os.path.isfile(mi):
        s = read(mi)
        s = re.sub(r"(?m)^- \[knowledge-tree/.*\n", "", s)
        if "notepad/notepad.index.md" not in s:
            s = s.rstrip("\n") + "\n- [notepad/notepad.index.md](./notepad/notepad.index.md) — the knowledge inbox (buffer, never destination).\n"
        write(mi, s)
    # 4. the accumulator opens
    sp = os.path.join(mem, "save-points")
    os.makedirs(sp, exist_ok=True)
    nxt = os.path.join(sp, "next.save-point.md")
    if not os.path.isfile(nxt):
        seals = sorted(f[:-len(".save-point.md")] for f in os.listdir(sp) if f.endswith(".save-point.md") and f != "next.save-point.md")
        write(nxt, accumulator_text(seals[-1] if seals else None))
        spi = os.path.join(sp, "save-points.index.md")
        if os.path.isfile(spi) and "next.save-point.md" not in read(spi):
            s = read(spi)
            s = s.replace("## Children\n", "## Children\n\n- [next.save-point.md](./next.save-point.md) — **the open accumulator** (every ack-family commit appends a row).", 1)
            write(spi, s)
        print("opened save-points/next.save-point.md (the ack ledger accumulator)")
    # 5. F6: home's branch is the real one
    ht = os.path.join(mem, "tracks", "home.track.md")
    s = read(ht)
    if re.search(r"(?m)^branch: trunk\s*$", s):
        real = subprocess.run(["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True).stdout.strip() or "main"
        write(ht, re.sub(r"(?m)^branch: trunk\s*$", f"branch: {real}", s))
        print(f"home.track.md branch: trunk → {real} (F6, record-authoritative)")
    # 6. pin + re-projection
    set_core_version(pr.ws_path, dist_version(dist))
    print(f"core_version 0.7 → {dist_version(dist)}")
    if os.path.isfile(os.path.join(root, ".claude", "settings.json")):
        args.engine = "claude"
        args.project = root
        try:
            cmd_install(args)
        except SystemExit:
            pass
    print("\nmigrated. Remaining, by hand and by verb: (a) ack both repos as one unit — payload-first, row in the accumulator; (b) run `integrate-notepad` on the carried-over notes; (c) settle a Lore remote if the Memory repo has none (F12). Then `ai-lore.py check --from <dist>`.")
    args.dist = None
    args.since = None
    cmd_check(args)


# ----------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(prog="ai-lore.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", default=None, help="project root (default: nearest ancestor with .ai-lore-*/memory/workspace.yaml)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("resolve"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_resolve)
    s = sub.add_parser("check"); s.add_argument("--from", dest="dist", default=None); s.add_argument("--since", default=None, help="git ref: check journal-append-forward since this ref"); s.set_defaults(fn=cmd_check)
    s = sub.add_parser("install"); s.add_argument("engine", choices=["claude", "gemini"]); s.set_defaults(fn=cmd_install)
    s = sub.add_parser("upgrade"); s.add_argument("--from", dest="dist", required=True); s.set_defaults(fn=cmd_upgrade)
    s = sub.add_parser("init"); s.add_argument("dir"); s.add_argument("--name", required=True); s.add_argument("--from", dest="dist", required=True)
    s.add_argument("--branch", default="main"); s.add_argument("--publishing", action="store_true"); s.add_argument("--lore-remote", default=None); s.add_argument("--no-git", action="store_true"); s.set_defaults(fn=cmd_init)
    s = sub.add_parser("migrate"); s.add_argument("--from", dest="dist", required=True); s.set_defaults(fn=cmd_migrate)
    args = ap.parse_args(argv)
    if args.cmd != "init":
        if args.project:
            args.project = os.path.abspath(args.project)
            if not is_project_root(args.project):
                die(f"--project {args.project} is not an AI-Lore project root")
        else:
            args.project = find_project(os.getcwd())
            if not args.project:
                die("not inside an AI-Lore project (pass --project)")
    args.fn(args)


if __name__ == "__main__":
    main()
