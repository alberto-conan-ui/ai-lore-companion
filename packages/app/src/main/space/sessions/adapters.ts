/**
 * The text of the two hook adapters (phase M4.4; M10.5 gives each a
 * `--dialect` argument so the same two scripts serve every engine).
 *
 * The dialect (`claude`, `antigravity`, `codex` or `opencode`; default
 * `claude`) decides only how the hook's input is read (`written_paths`, which
 * paths a call writes; `shell_command`, whether it is a shell command a
 * dialect's adapter judges) and how the decision is printed (`emit_pre`,
 * `emit_post`). Running the check scripts, the alarm, the refusal note and the
 * scrub of the desk path are shared. Only `claude` is built in this phase; the
 * other three raise a `Fault` that says so, in a block marked
 * `# dialect: <name>` for the phase that replaces it.
 *
 * The adapters are Python 3, standard library only, as the check scripts are.
 * Their text is kept here as constants and written into each session's folder
 * when the session starts (architecture document, section 10.1 question 14,
 * the default): there is no `.py` file under `packages/app`.
 *
 * What the text rests on, observed with the real engine in phase M4.1
 * (`packages/docs/m4-1-claude-code-findings.md`, section 2):
 *
 * - A `PreToolUse` hook that exits 1 or 3, or that reaches its timeout, does
 *   NOT block the write. So the before-write adapter has one way out for every
 *   case: it prints a JSON decision and exits 0. Every exception, a missing
 *   field, an exit code of a check that is neither 0 nor 2, a check that takes
 *   too long, the adapter's own alarm, and SIGTERM, SIGHUP or SIGINT all
 *   print `deny`. When standard output cannot be written, it exits 2, which
 *   also blocks. A SIGKILL, or a signal before Python has started, ends the
 *   adapter with no decision; the engine then asks, because no allow rule
 *   names a file-writing tool.
 * - Every reason has the mode sentence (Read only or Writing, and how to ask
 *   for Writing), and the desk's folder is replaced in it: a check script may
 *   name a desk record in its refusal.
 * - Exit 0 with no output does not grant permission, and a JSON `allow` does.
 *   The session's `settings.json` has no allow rule for the file-writing tools,
 *   so a write happens only after this adapter printed `allow`. If the hook
 *   ever failed without blocking, the engine would ask the Human Lead.
 * - A JSON `deny` shows the model the reason only. Exit 2 shows it the whole
 *   hook command, which holds the desk's path.
 *
 * Not observed, to be verified by phase M4.8: the `PostToolUse` JSON form
 * (`decision: "block"` with a `reason`) that the after-write adapter prints.
 *
 * The constants are written with `String.raw`, so a backslash in the Python
 * text stays a backslash. The Python text holds no backtick and no `${`.
 */

/** What both adapters share: arguments, the hook's input, the path, running a check, the alarm. */
const ADAPTER_COMMON = String.raw`
import fnmatch
import json
import os
import signal
import subprocess
import sys
import time
import unicodedata

REASON_LIMIT = 4000
CHILD = [None]
ARGUMENTS = [None]
FINISHING = [False]
DESK_SHOWN = '<the desk folder>'
HOLDER_SHOWN = "<the companion's folder of this Space>"


class Fault(Exception):
    """The adapter could not do its work. The message is a clause."""


class Refused(Exception):
    """A check script refused. The message is what it wrote on standard error."""


DIALECTS = ('claude', 'antigravity', 'codex', 'opencode')

# Antigravity CLI (M10.6, m10-architecture.md 2.3 and 5 M10.6 item 2).
AGY_FILE_TOOLS = ('write_to_file', 'replace_file_content', 'multi_replace_file_content',
                   'edit_notebook', 'create_file', 'edit_file', 'delete_file', 'move_file')
AGY_PATH_KEYS = ('TargetFile', 'AbsolutePath', 'FilePath', 'NotebookPath', 'SourcePath',
                  'DestinationPath', 'Path')
AGY_READ_TOOLS = ('view_file', 'list_directory', 'grep_search', 'find', 'view_file_outline',
                   'view_content_chunk', 'view_code_item', 'find_all_references',
                   'codebase_search')
# The plugin's name is fixed 'lore' (engines/antigravity.ts PLUGIN_DIR) and the session
# server's name is fixed 'ailore' (session-server/constants.ts SESSION_SERVER_NAME), so the
# server name Antigravity shows the model for a session-server call is always this exact
# string. Matched exactly below, not as a substring: a substring match would let a spoofing
# MCP server (for example from the Human Lead's own global Antigravity configuration, which
# cannot be left out, 2.3) whose name merely contains "ailore" be treated as the session
# server's calls and allowed.
AGY_SESSION_SERVER_NAME = 'lore_ailore'


def bash_rule_inner(rule):
    """The text inside Bash(...) of one allow or deny rule, or None for anything else."""
    if not isinstance(rule, str) or not rule.startswith('Bash(') or not rule.endswith(')'):
        return None
    return rule[len('Bash('):-1]


def parse_arguments(argv):
    single = ('--space', '--desk', '--session', '--request-tool', '--refusals',
              '--child-seconds', '--adapter-seconds', '--dialect', '--shell-rules',
              '--uncovered-shell')
    found = {'--check': []}
    index = 0
    while index < len(argv):
        name = argv[index]
        if index + 1 >= len(argv):
            raise Fault('the command line of the adapter is wrong (%s has no value)' % name)
        value = argv[index + 1]
        if name == '--check':
            found['--check'].append(value)
        elif name in single and name not in found:
            found[name] = value
        else:
            raise Fault('the command line of the adapter is wrong (%s)' % name)
        index += 2
    for name in ('--space', '--desk', '--session', '--child-seconds', '--adapter-seconds'):
        if not found.get(name):
            raise Fault('the command line of the adapter is wrong (%s is missing)' % name)
    for name in ('--space', '--desk'):
        if not os.path.isabs(found[name]):
            raise Fault('the command line of the adapter is wrong (%s is not an absolute path)' % name)
    if not found['--check']:
        raise Fault('the command line of the adapter names no check script')
    found['--child-seconds'] = int(found['--child-seconds'])
    found['--adapter-seconds'] = int(found['--adapter-seconds'])
    if found['--child-seconds'] <= 0 or found['--adapter-seconds'] <= 0:
        raise Fault('the command line of the adapter is wrong (a time limit is not positive)')
    found.setdefault('--dialect', 'claude')
    if found['--dialect'] not in DIALECTS:
        raise Fault('the command line of the adapter is wrong (--dialect %s is not known)' % found['--dialect'])
    found.setdefault('--uncovered-shell', 'ask')
    if found['--uncovered-shell'] not in ('ask', 'deny'):
        raise Fault('the command line of the adapter is wrong (--uncovered-shell %s is not known)'
                     % found['--uncovered-shell'])
    return found


def read_hook_input():
    data = json.loads(sys.stdin.read())
    if not isinstance(data, dict):
        raise Fault('the input of the hook is not a JSON object')
    return data


def tool_name(data, dialect):
    """The tool's name, dialect by dialect, for the refusals log."""
    if dialect == 'antigravity':
        tool_call = data.get('toolCall')
        name = tool_call.get('name') if isinstance(tool_call, dict) else None
        return name if isinstance(name, str) and name else 'an unknown tool'
    name = data.get('tool_name')
    return name if isinstance(name, str) and name else 'an unknown tool'


def written_paths_antigravity(data):
    """Every string value of toolCall.args under a key of AGY_PATH_KEYS, for a name of
    AGY_FILE_TOOLS; a relative one is joined to workspacePaths[0]. Raises Fault when none is
    found. [] for any other tool name."""
    tool_call = data.get('toolCall')
    if not isinstance(tool_call, dict):
        raise Fault('the input of the hook has no toolCall')
    name = tool_call.get('name')
    if not isinstance(name, str) or name not in AGY_FILE_TOOLS:
        return []
    args = tool_call.get('args')
    if not isinstance(args, dict):
        raise Fault('the input of the hook names no file for the tool %s' % name)
    workspace_paths = data.get('workspacePaths')
    base = None
    if isinstance(workspace_paths, list) and workspace_paths and isinstance(workspace_paths[0], str):
        base = workspace_paths[0]
    paths = []
    for key in AGY_PATH_KEYS:
        value = args.get(key)
        if not isinstance(value, str) or not value:
            continue
        if '\x00' in value:
            raise Fault('the path in the input of the hook holds a NUL character')
        if os.path.isabs(value):
            paths.append(value)
        elif base is not None:
            paths.append(os.path.join(base, value))
        else:
            raise Fault('the path in the input of the hook is relative and the input gives no workspace folder')
    if not paths:
        raise Fault('the input of the hook names no file for the tool %s' % name)
    return paths


def shell_command_antigravity(data):
    """(CommandLine, Cwd or workspacePaths[0]) for a run_command call, else None."""
    tool_call = data.get('toolCall')
    if not isinstance(tool_call, dict) or tool_call.get('name') != 'run_command':
        return None
    args = tool_call.get('args')
    if not isinstance(args, dict):
        raise Fault('the input of the hook names no command for the tool run_command')
    command = args.get('CommandLine')
    if not isinstance(command, str):
        raise Fault('the input of the hook names no command for the tool run_command')
    cwd = args.get('Cwd')
    if not isinstance(cwd, str) or not cwd:
        workspace_paths = data.get('workspacePaths')
        if isinstance(workspace_paths, list) and workspace_paths and isinstance(workspace_paths[0], str):
            cwd = workspace_paths[0]
        else:
            cwd = ''
    return command, cwd


def written_path_claude(data):
    """The absolute path the tool call writes. Raises Fault when the input does not give one."""
    tool_input = data.get('tool_input')
    if not isinstance(tool_input, dict):
        raise Fault('the input of the hook has no tool_input')
    raw = None
    for key in ('file_path', 'notebook_path'):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            raw = value
            break
    if raw is None:
        raise Fault('the input of the hook names no file (tool_input has neither file_path nor notebook_path)')
    if '\x00' in raw:
        raise Fault('the path in the input of the hook holds a NUL character')
    if os.path.isabs(raw):
        return raw
    cwd = data.get('cwd')
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or '\x00' in cwd:
        raise Fault('the path in the input of the hook is relative and the input gives no working folder')
    return os.path.join(cwd, raw)


def written_paths_codex(data):
    """The paths one apply_patch (also Edit, Write) call writes, from the lines of its patch
    text: '*** Add File: ', '*** Update File: ', '*** Delete File: ' and '*** Move to: ' each
    give a path, the rest of the line, stripped. Raises Fault when tool_input.command is not a
    string, or names no file line."""
    tool_input = data.get('tool_input')
    if not isinstance(tool_input, dict):
        raise Fault('the input of the hook has no tool_input')
    command = tool_input.get('command')
    if not isinstance(command, str):
        raise Fault('the input of the hook names no file (tool_input.command is not a string)')
    cwd = data.get('cwd')
    prefixes = ('*** Add File: ', '*** Update File: ', '*** Delete File: ', '*** Move to: ')
    paths = []
    for line in command.split('\n'):
        for prefix in prefixes:
            if not line.startswith(prefix):
                continue
            raw = line[len(prefix):].strip()
            if '\x00' in raw:
                raise Fault('the path in the input of the hook holds a NUL character')
            if os.path.isabs(raw):
                paths.append(raw)
            elif isinstance(cwd, str) and os.path.isabs(cwd) and '\x00' not in cwd:
                paths.append(os.path.join(cwd, raw))
            else:
                raise Fault('the path in the input of the hook is relative and the input gives no working folder')
            break
    if not paths:
        raise Fault('the patch names no file')
    return paths


def resolve_opencode_path(raw, cwd):
    """One path from OpenCode's guard plugin: absolute already, or joined to cwd."""
    if not isinstance(raw, str) or not raw:
        raise Fault('the input of the hook names no file (args names no path)')
    if '\x00' in raw:
        raise Fault('the path in the input of the hook holds a NUL character')
    if os.path.isabs(raw):
        return raw
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or '\x00' in cwd:
        raise Fault('the path in the input of the hook is relative and the input gives no working folder')
    return os.path.join(cwd, raw)


def written_paths_opencode(data):
    """OpenCode's guard plugin sends {tool, args, cwd}. edit and write name the path in
    args.filePath; apply_patch names it in the *** Add File:, *** Update File:,
    *** Delete File: and *** Move to: lines of args.patchText (the Codex patch format,
    m10-architecture.md 2.4). Any other tool writes no file."""
    tool = data.get('tool')
    args = data.get('args')
    if not isinstance(args, dict):
        raise Fault('the input of the hook has no args')
    cwd = data.get('cwd')
    if tool in ('edit', 'write'):
        return [resolve_opencode_path(args.get('filePath'), cwd)]
    if tool == 'apply_patch':
        text = args.get('patchText')
        if not isinstance(text, str) or not text:
            raise Fault('the input of the hook names no file (apply_patch has no patchText)')
        prefixes = ('*** Add File: ', '*** Update File: ', '*** Delete File: ', '*** Move to: ')
        paths = []
        for line in text.split('\n'):
            for prefix in prefixes:
                if line.startswith(prefix):
                    paths.append(resolve_opencode_path(line[len(prefix):].strip(), cwd))
        if not paths:
            raise Fault('the input of the hook names no file (apply_patch names no path)')
        return paths
    return []


def written_paths(data, dialect):
    """The absolute paths the tool call writes, dialect by dialect. An empty list for a
    call that writes no file. Raises Fault when a file tool's input names no path."""
    # dialect: claude
    if dialect == 'claude':
        return [written_path_claude(data)]
    # dialect: antigravity
    if dialect == 'antigravity':
        return written_paths_antigravity(data)
    if dialect == 'codex':
        return written_paths_codex(data)
    # dialect: opencode
    if dialect == 'opencode':
        return written_paths_opencode(data)
    if dialect in DIALECTS:
        raise Fault('the %s dialect is not built yet' % dialect)
    raise Fault('the dialect "%s" is not known' % dialect)


def shell_command(data, dialect):
    """(command, cwd) for a shell call of a dialect whose adapter judges the shell
    (Antigravity), else None."""
    # dialect: claude
    if dialect == 'claude':
        return None
    # dialect: antigravity
    if dialect == 'antigravity':
        return shell_command_antigravity(data)
    if dialect == 'codex':
        return None
    # dialect: opencode
    if dialect == 'opencode':
        return None
    if dialect in DIALECTS:
        raise Fault('the %s dialect is not built yet' % dialect)
    raise Fault('the dialect "%s" is not known' % dialect)


def kill_child():
    child = CHILD[0]
    if child is not None:
        try:
            child.kill()
        except Exception:
            pass


def run_check(script, arguments, path, when, seconds):
    """Returns what the script printed when it allows. Raises Refused or Fault."""
    name = os.path.basename(script)
    if not os.path.isabs(script) or not os.path.isfile(script):
        raise Fault('the check script %s is missing from the companion\'s install' % name)
    if not sys.executable:
        raise Fault('the path of python3 is not known')
    if seconds <= 0:
        raise Fault('the checks did not finish in time')
    command = [sys.executable, script, '--space', arguments['--space'], '--desk', arguments['--desk'],
               '--session', arguments['--session'], '--path', path, '--when', when]
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, shell=False)
    except Exception as error:
        raise Fault('the check script %s could not be started (%s)' % (name, type(error).__name__))
    CHILD[0] = child
    try:
        try:
            out, err = child.communicate(timeout=seconds)
        except subprocess.TimeoutExpired:
            kill_child()
            raise Fault('the check script %s did not finish in %d seconds' % (name, seconds))
    finally:
        CHILD[0] = None
    if child.returncode == 0:
        return out.decode('utf-8', 'replace').strip()
    if child.returncode == 2:
        text = err.decode('utf-8', 'replace').strip()
        raise Refused(text if text else '%s refuses the write and gave no reason.' % name)
    raise Fault('the check script %s ended with the exit code %s, which is neither 0 nor 2'
                % (name, child.returncode))


def start_alarm(seconds, on_alarm):
    try:
        signal.signal(signal.SIGALRM, lambda number, frame: on_alarm())
        signal.alarm(seconds)
    except (AttributeError, ValueError):
        pass  # a platform without SIGALRM: the time limit of each child still holds


def catch_signals(on_signal):
    """A signal that would end the adapter without output (SIGTERM, SIGHUP, SIGINT) runs on_signal instead."""
    for name in ('SIGTERM', 'SIGHUP', 'SIGINT'):
        number = getattr(signal, name, None)
        if number is None:
            continue
        try:
            signal.signal(number, lambda received, frame, name=name: on_signal(name))
        except (OSError, ValueError):
            pass


def scrub(text):
    """The text with the desk's folder, and the folder that holds it, replaced: the session is not told where the desk is."""
    arguments = ARGUMENTS[0]
    if not arguments or not arguments.get('--desk'):
        return text
    desk = arguments['--desk'].rstrip(os.sep) or arguments['--desk']
    forms = {}
    for folder, shown_as in ((os.path.dirname(desk), HOLDER_SHOWN), (desk, DESK_SHOWN)):
        forms[folder] = shown_as
        try:
            forms[os.path.realpath(folder)] = shown_as
        except Exception:
            pass
    for form in sorted(forms, key=len, reverse=True):
        if len(form) > 1:
            text = text.replace(form, forms[form])
    return text


def clip(text):
    text = scrub(text)
    return text if len(text) <= REASON_LIMIT else text[:REASON_LIMIT] + ' [shortened]'
`;

/**
 * The before-write adapter, `hooks/pre-write.py`. Registered as a `PreToolUse`
 * hook for the file-writing tools. It runs every before-write check script of
 * the install on the path; each script decides by itself whether the path is
 * its concern (write-guard for every path, lore-integrity for the Lore,
 * journal-append-forward for the journal).
 */
export const PRE_WRITE_ADAPTER = String.raw`#!/usr/bin/env python3
"""pre-write.py: the Claude Code adapter for the before-write checks of an AI-Lore 1.0 session.

Written by the companion when the session starts. Do not edit: it is written again for each session.

It reads the JSON of a PreToolUse hook on standard input, runs each check script
given with --check on the path the tool call writes, and prints one JSON decision.
It always ends with exit code 0 and a decision, allow or deny. Anything that goes
wrong prints deny: the engine lets a write through when a hook fails in another way.
"""${ADAPTER_COMMON}
EVENT = 'PreToolUse'
SESSIONS_RECORD = 'sessions.json'
STATE = {'refusals': None, 'tool': 'an unknown tool', 'path': None}


def emit(decision, reason):
    dialect = (ARGUMENTS[0] or {}).get('--dialect', 'claude')
    try:
        emit_pre(decision, reason, dialect)
    except Fault:
        # A dialect whose own decision form is not built yet must still fail
        # closed: fall back to the claude form rather than leave the adapter
        # without a decision.
        emit_pre(decision, reason, 'claude')


def emit_pre(decision, reason, dialect):
    """Print the hook's decision, dialect by dialect. claude prints Claude Code's JSON form."""
    # dialect: antigravity
    if dialect == 'antigravity':
        # Antigravity's PreToolUse hook prints {"decision": ..., "reason": ...} at the top
        # level (m10-architecture.md 2.3, 5 M10.6 item 2); no reason key for allow and ask.
        if FINISHING[0]:
            return
        FINISHING[0] = True
        out = {'decision': decision}
        if decision not in ('allow', 'ask'):
            out['reason'] = clip(reason)
        try:
            sys.stdout.write(json.dumps(out) + '\n')
            sys.stdout.flush()
        except Exception:
            os._exit(2)
        os._exit(0)
    # dialect: codex
    if dialect == 'codex':
        # Codex's PreToolUse hook: deny with the hookSpecificOutput JSON form (as claude);
        # allow prints nothing and exits 0 (any other exit code lets the call go on).
        if FINISHING[0]:
            return
        FINISHING[0] = True
        if decision == 'allow':
            os._exit(0)
        out = {'hookSpecificOutput': {'hookEventName': EVENT, 'permissionDecision': decision,
                                      'permissionDecisionReason': clip(reason)}}
        try:
            sys.stdout.write(json.dumps(out) + '\n')
            sys.stdout.flush()
        except Exception:
            os._exit(2)
        os._exit(0)
    # dialect: opencode
    if dialect == 'opencode':
        # OpenCode's guard plugin parses {"decision": "allow"|"deny", "reason": ...} at the
        # top level (m10-architecture.md 5 M10.8 item 1); no reason key for allow.
        if FINISHING[0]:
            return
        FINISHING[0] = True
        out = {'decision': decision}
        if decision != 'allow':
            out['reason'] = clip(reason)
        try:
            sys.stdout.write(json.dumps(out) + '\n')
            sys.stdout.flush()
        except Exception:
            os._exit(2)
        os._exit(0)
    # dialect: claude
    if dialect != 'claude':
        raise Fault('the %s dialect is not built yet' % dialect)
    if FINISHING[0]:
        return  # a signal arrived while the decision was being written; that decision stands
    FINISHING[0] = True
    out = {'hookSpecificOutput': {'hookEventName': EVENT, 'permissionDecision': decision,
                                  'permissionDecisionReason': clip(reason)}}
    try:
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()
    except Exception:
        os._exit(2)  # standard output is gone; exit code 2 is the other way to block the call
    os._exit(0)


def note_refusal(kind, reason):
    """One line in the session's refusals file, which the companion reads into its log. Never decides."""
    try:
        if not STATE['refusals']:
            return
        line = json.dumps({'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kind': kind,
                           'tool': STATE['tool'], 'path': STATE['path'], 'reason': clip(reason)})
        descriptor = os.open(STATE['refusals'], os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(descriptor, (line + '\n').encode('utf-8'))
        finally:
            os.close(descriptor)
    except Exception:
        pass


def deny(kind, reason):
    if FINISHING[0]:
        return
    note_refusal(kind, reason)
    emit('deny', reason)


def refuse_fault(clause):
    deny('fault', '%s %s' % (fault_sentence(clause), what_the_session_can_do()))


def session_mode(desk, session):
    """'read-only', 'writing', or None when the desk's record cannot be read."""
    try:
        with open(os.path.join(desk, SESSIONS_RECORD), encoding='utf-8') as handle:
            data = json.load(handle)
        for record in data.get('records', []):
            if isinstance(record, dict) and record.get('id') == session:
                if record.get('mode') == 'writing' and record.get('closedAt') is None:
                    return 'writing'
                return 'read-only'
        return 'read-only'  # the write-guard reads a session with no record as Read only
    except FileNotFoundError:
        return 'read-only'
    except Exception:
        return None


def what_the_session_can_do():
    arguments = ARGUMENTS[0] or {}
    tool = arguments.get('--request-tool') or 'request_writing'
    mode = session_mode(arguments['--desk'], arguments['--session']) if ARGUMENTS[0] else None
    if mode == 'read-only':
        return ('The session is in Read only. In Read only a session writes only to the Workbench '
                '(the folder workbench/ of the Space). To write to the Lore or to a payload, ask the '
                'Human Lead for Writing with the tool %s, naming the targets, and wait for the answer.' % tool)
    if mode == 'writing':
        return ('The session is in Writing. In Writing a session writes to the targets it claimed, to a '
                'repository only while the claimed branch is checked out, and to the Workbench. To write '
                'to another target, ask for it with the tool %s.' % tool)
    return ('The mode of the session (Read only or Writing) could not be read here. In Read only a session '
            'writes only to the Workbench; to write to the Lore or to a payload it asks the Human Lead for '
            'Writing with the tool %s.' % tool)


def fault_sentence(clause):
    return ('The write is refused because the companion\'s before-write check could not be made: %s. '
            'This is a fault of the companion or of its install and not of the path. Do not try the '
            'write in another way; tell the Human Lead.' % clause)


def on_signal(name):
    kill_child()
    refuse_fault('the adapter was stopped by the signal %s' % name)


UNCOVERED_SHELL_REASON = (
    "This session skips Antigravity's own prompts, so a shell command outside the session's "
    "rules is refused. Run it yourself, or start the session without "
    "--dangerously-skip-permissions.")


def decide_antigravity_shell(command, cwd, arguments):
    """deny, allow or force_ask for a run_command call, judged by shell-rules.json
    (m10-architecture.md 5, M10.6 item 2). Human Lead's ruling of 2026-09-19: when the
    session was started with --dangerously-skip-permissions, --uncovered-shell is 'deny'
    and a command the rules would otherwise only force_ask about is denied instead, since
    the engine's own prompt (which force_ask relies on) is skipped."""
    STATE['path'] = cwd
    rules_path = arguments.get('--shell-rules')
    try:
        if not rules_path:
            raise Fault('no shell rules were given to the adapter')
        with open(rules_path, encoding='utf-8') as handle:
            rules = json.load(handle)
        if not isinstance(rules, dict):
            raise Fault('the shell rules file is not a JSON object')
    except Fault as fault:
        deny('fault', '%s %s' % (fault_sentence(str(fault)), what_the_session_can_do()))
        return
    except Exception as error:
        deny('fault', '%s %s' % (fault_sentence('the shell rules could not be read (%s)'
                                                  % type(error).__name__), what_the_session_can_do()))
        return
    allow_rules = rules.get('allow')
    deny_rules = rules.get('deny')
    allow_rules = allow_rules if isinstance(allow_rules, list) else []
    deny_rules = deny_rules if isinstance(deny_rules, list) else []
    for rule in deny_rules:
        inner = bash_rule_inner(rule)
        if inner is not None and fnmatch.fnmatchcase(command, inner):
            deny('refused', 'The command is refused in a companion session: it matches the rule "%s".' % rule)
            return
    meta_characters = (';', '|', '&', chr(96), '$(', '>', '<', '\n')
    has_meta = any(character in command for character in meta_characters)
    same_cwd = False
    space = arguments.get('--space')
    if not has_meta and space:
        try:
            same_cwd = bool(cwd) and os.path.realpath(cwd) == os.path.realpath(space)
        except Exception:
            same_cwd = False
    if not has_meta and same_cwd:
        for rule in allow_rules:
            inner = bash_rule_inner(rule)
            if inner is None:
                continue
            if inner.endswith(':*'):
                prefix = inner[:-2]
                if command == prefix or command.startswith(prefix + ' '):
                    emit('allow', '')
                    return
            elif command == inner:
                emit('allow', '')
                return
    if arguments.get('--uncovered-shell') == 'deny':
        deny('refused', UNCOVERED_SHELL_REASON)
        return
    emit('force_ask', "The companion's rules do not cover this command; the Human Lead decides.")


def decide_antigravity(data, arguments, deadline):
    """The pre-write decision for Antigravity CLI (m10-architecture.md 5, M10.6 item 2), in
    order: a file tool checks every path it names; run_command follows the shell rules; a call
    of the session server's MCP server (toolCall.name "call_mcp_tool", args.ServerName holding
    "ailore") or a tool in AGY_READ_TOOLS is allowed; anything else asks.

    Finding, observed 2026-09-19 with agy 1.2.7 (differs from what m10-architecture.md 2.3
    assumed from the model's own words): the hook's toolCall.name for a session-server call is
    the fixed name "call_mcp_tool", not a name holding the plugin's server name. The server and
    tool called are in toolCall.args.ServerName ("lore_ailore") and .ToolName ("await_answer",
    "request_writing", ...). A check by toolCall.name alone would send every session-server
    call to the "anything else asks" branch, which blocks headless real-engine checks.

    A malformed or missing toolCall (not a dict, or with no string name) is not "anything
    else": it is broken input, and fails closed with a Fault (a deny), as the other dialects'
    written_paths already do for missing fields, rather than silently asking."""
    tool_call = data.get('toolCall')
    if not isinstance(tool_call, dict):
        raise Fault('the input of the hook has no toolCall')
    name = tool_call.get('name')
    if not isinstance(name, str) or not name:
        raise Fault('the input of the hook names no tool')
    args = tool_call.get('args')
    if name in AGY_FILE_TOOLS:
        allowed = []
        for path in written_paths(data, 'antigravity'):
            STATE['path'] = path
            for script in arguments['--check']:
                remaining = int(deadline - time.monotonic())
                try:
                    allowed.append(run_check(script, arguments, path, 'before',
                                             min(arguments['--child-seconds'], remaining)))
                except Refused as refusal:
                    deny('refused', '%s %s' % (refusal, what_the_session_can_do()))
        emit('allow', ' '.join(text for text in allowed if text) or 'The before-write checks allow the write.')
        return
    shell = shell_command(data, 'antigravity')
    if shell is not None:
        decide_antigravity_shell(shell[0], shell[1], arguments)
        return
    server_name = args.get('ServerName') if isinstance(args, dict) else None
    is_session_server_call = name == 'call_mcp_tool' and server_name == AGY_SESSION_SERVER_NAME
    if is_session_server_call or ('ailore' in name or name in AGY_READ_TOOLS):
        emit('allow', '')
        return
    emit('ask', '')


def main():
    arguments = parse_arguments(sys.argv[1:])
    ARGUMENTS[0] = arguments
    STATE['refusals'] = arguments.get('--refusals')
    deadline = time.monotonic() + arguments['--adapter-seconds']

    def on_alarm():
        kill_child()
        refuse_fault('the checks did not finish in %d seconds' % arguments['--adapter-seconds'])

    start_alarm(arguments['--adapter-seconds'], on_alarm)
    data = read_hook_input()
    STATE['tool'] = tool_name(data, arguments['--dialect'])
    if arguments['--dialect'] == 'antigravity':
        # Antigravity's decision is not one path per call: a file tool may name several paths,
        # a shell call has none, and other tools are judged by name, not by path (decide_antigravity).
        decide_antigravity(data, arguments, deadline)
        return
    # A call may write more than one path (a Codex apply_patch may add, update, delete or move
    # several files in one call; an Antigravity tool may take more than one path key): every
    # path is checked, and a refusal on any one of them denies the whole call (M10.7, also
    # needed by M10.6's written_paths_antigravity).
    paths = written_paths(data, arguments['--dialect'])
    allowed = []
    for path in paths:
        STATE['path'] = path
        for script in arguments['--check']:
            remaining = int(deadline - time.monotonic())
            try:
                allowed.append(run_check(script, arguments, path, 'before',
                                         min(arguments['--child-seconds'], remaining)))
            except Refused as refusal:
                deny('refused', '%s %s' % (refusal, what_the_session_can_do()))
    emit('allow', ' '.join(text for text in allowed if text) or 'The before-write checks allow the write.')


if __name__ == '__main__':
    catch_signals(on_signal)
    try:
        main()
    except Fault as fault:
        refuse_fault(str(fault))
    except BaseException as error:  # SystemExit and KeyboardInterrupt too: nothing leaves without a decision
        refuse_fault('the adapter failed with %s' % type(error).__name__)
    refuse_fault('the adapter ended without a decision')
    os._exit(2)  # not reached: every refusal above exits; exit code 2 also blocks the call
`;

/**
 * The after-write adapter, `hooks/post-write.py`. Registered as a `PostToolUse`
 * hook for the file-writing tools. When the write was in the Lore it runs each
 * after-write check script of the install (lore-integrity) and reports a
 * failure to the session. The write has happened by then, so nothing is refused
 * here; a failure of the adapter itself is reported to the session too.
 */
export const POST_WRITE_ADAPTER = String.raw`#!/usr/bin/env python3
"""post-write.py: the Claude Code adapter for the after-write checks of an AI-Lore 1.0 session.

Written by the companion when the session starts. Do not edit: it is written again for each session.

It reads the JSON of a PostToolUse hook on standard input. When the written path
is in the Lore it runs each check script given with --check with --when after,
and reports a failure to the session. A write outside the Lore prints nothing.
"""${ADAPTER_COMMON}
EVENT = 'PostToolUse'
STATE = {'tool': 'an unknown tool', 'path': None}


def note_after_write_refusal(reason):
    """One line in the session's refusals file, kind after-write (antigravity only, emit_post):
    the report a Claude Code session gets from PostToolUse cannot reach an Antigravity one."""
    try:
        refusals = (ARGUMENTS[0] or {}).get('--refusals')
        if not refusals:
            return
        line = json.dumps({'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kind': 'after-write',
                           'tool': STATE['tool'], 'path': STATE['path'], 'reason': clip(reason)})
        descriptor = os.open(refusals, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(descriptor, (line + '\n').encode('utf-8'))
        finally:
            os.close(descriptor)
    except Exception:
        pass


def report(reason):
    dialect = (ARGUMENTS[0] or {}).get('--dialect', 'claude')
    try:
        emit_post(reason, dialect)
    except Fault:
        # A dialect whose own report form is not built yet must not crash the
        # session: fall back to the claude form rather than leave an
        # uncaught exception.
        emit_post(reason, 'claude')


def emit_post(problem, dialect):
    """Report a problem found after the write, dialect by dialect, or do nothing for None.
    claude prints Claude Code's PostToolUse block form."""
    # dialect: antigravity
    if dialect == 'antigravity':
        # A PostToolUse handler cannot send a message to an Antigravity session (2.3): it
        # must print {}. A problem is noted in refusals.jsonl instead, kind after-write.
        if problem is not None:
            note_after_write_refusal(problem)
        if FINISHING[0]:
            return
        FINISHING[0] = True
        try:
            sys.stdout.write(json.dumps({}) + '\n')
            sys.stdout.flush()
        except Exception:
            pass
        os._exit(0)
    # dialect: opencode
    if dialect == 'opencode':
        # No after-write hook is wired for OpenCode in this phase (m10-architecture.md 5,
        # M10.8 item 2): the guard plugin registers tool.execute.before only, so this is
        # never reached in a real session, but the fallback of report() may still call it.
        return
    # dialect: claude
    # dialect: codex (codex reuses the Claude Code form: m10-architecture.md 5, M10.7 item 2)
    if dialect not in ('claude', 'codex'):
        raise Fault('the %s dialect is not built yet' % dialect)
    if problem is None:
        return
    if FINISHING[0]:
        return
    FINISHING[0] = True
    reason = clip(problem)
    out = {'decision': 'block', 'reason': reason,
           'hookSpecificOutput': {'hookEventName': EVENT, 'additionalContext': reason}}
    try:
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()
    except Exception:
        try:
            sys.stderr.write(reason + '\n')
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(2)  # for PostToolUse, exit code 2 shows standard error to the session
    os._exit(0)


def folded(path):
    return unicodedata.normalize('NFC', path).casefold()


def in_lore(space, path):
    lore = folded(os.path.realpath(os.path.join(space, 'lore')))
    resolved = folded(os.path.realpath(path))
    return resolved == lore or resolved.startswith(lore + os.sep)


def fault_sentence(clause):
    return ('The companion\'s after-write check of the Lore could not be made: %s. The write has happened. '
            'Tell the Human Lead that the Lore was not checked.' % clause)


def on_signal(name):
    kill_child()
    report(fault_sentence('the adapter was stopped by the signal %s' % name))


def main():
    arguments = parse_arguments(sys.argv[1:])
    ARGUMENTS[0] = arguments
    deadline = time.monotonic() + arguments['--adapter-seconds']

    def on_alarm():
        kill_child()
        report(fault_sentence('the checks did not finish in %d seconds' % arguments['--adapter-seconds']))

    start_alarm(arguments['--adapter-seconds'], on_alarm)
    data = read_hook_input()
    path = written_paths(data, arguments['--dialect'])[0]
    STATE['tool'] = tool_name(data, arguments['--dialect'])
    STATE['path'] = path
    if not in_lore(arguments['--space'], path):
        os._exit(0)
    failures = []
    for script in arguments['--check']:
        remaining = int(deadline - time.monotonic())
        try:
            run_check(script, arguments, path, 'after', min(arguments['--child-seconds'], remaining))
        except Refused as refusal:
            failures.append(str(refusal))
    if failures:
        report('After the write to %s the Lore fails a check. %s Fix what is reported before leaving Writing.'
               % (path, ' '.join(failures)))
    os._exit(0)


if __name__ == '__main__':
    catch_signals(on_signal)
    try:
        main()
    except Fault as fault:
        report(fault_sentence(str(fault)))
    except BaseException as error:
        report(fault_sentence('the adapter failed with %s' % type(error).__name__))
`;

/**
 * `opencode/plugins/lore-guard.js` (phase M10.8, `m10-architecture.md` 5 M10.8
 * item 1): OpenCode's own guard plugin, written into the session's folder
 * when the session starts. It hands every `edit`, `write` and `apply_patch`
 * call to the before-write Python adapter (`PRE_WRITE_ADAPTER` above, run
 * with `--dialect opencode`) and throws when the adapter does not answer
 * `allow`, so OpenCode refuses the call.
 *
 * `__LORE_GUARD_ARGV__` is a placeholder: the OpenCode adapter's `launch`
 * (`engines/opencode.ts`) replaces it with `JSON.stringify(argv)`, `argv`
 * being `hookArgv` for `hooks/pre-write.py` with `--dialect opencode` (the
 * python path, the adapter path and the hook arguments, as the specification
 * asks). The result is a plain JSON array literal, so the substitution cannot
 * break the surrounding JavaScript.
 */
export const OPENCODE_GUARD_PLUGIN = String.raw`/**
 * lore-guard.js: the AI-Lore companion's before-write guard for an OpenCode
 * session. Written by the companion when the session starts. Do not edit: it
 * is written again for each session.
 *
 * OpenCode runs this plugin's tool.execute.before hook before edit, write and
 * apply_patch calls. It hands the call to the companion's before-write
 * adapter (the same adapter Claude Code uses, run with --dialect opencode)
 * and throws when the adapter does not answer allow, so the call is refused.
 */

import { spawnSync } from 'node:child_process';

const HOOK_ARGV = __LORE_GUARD_ARGV__;
const GUARDED_TOOLS = ['edit', 'write', 'apply_patch'];
const FALLBACK_REASON =
  "The companion's before-write check could not be made; the write is refused. Tell the Human Lead.";

export const LoreGuard = async ({ directory }) => {
  return {
    'tool.execute.before': async (input, output) => {
      if (!GUARDED_TOOLS.includes(input.tool)) return;
      const [command, ...args] = HOOK_ARGV;
      let result;
      try {
        result = spawnSync(command, args, {
          input: JSON.stringify({ tool: input.tool, args: output.args, cwd: directory }),
          timeout: 55000,
          encoding: 'utf8',
        });
      } catch (error) {
        throw new Error(FALLBACK_REASON);
      }
      let decision = null;
      if (result && !result.error && result.status === 0 && typeof result.stdout === 'string') {
        try {
          decision = JSON.parse(result.stdout);
        } catch (error) {
          decision = null;
        }
      }
      if (!decision || decision.decision !== 'allow') {
        const reason = decision && typeof decision.reason === 'string' ? decision.reason : '';
        throw new Error(reason || FALLBACK_REASON);
      }
    },
  };
};
`;
