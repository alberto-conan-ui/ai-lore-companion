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


def parse_arguments(argv):
    single = ('--space', '--desk', '--session', '--request-tool', '--refusals',
              '--child-seconds', '--adapter-seconds', '--dialect')
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
    return found


def read_hook_input():
    data = json.loads(sys.stdin.read())
    if not isinstance(data, dict):
        raise Fault('the input of the hook is not a JSON object')
    return data


def tool_name(data):
    name = data.get('tool_name')
    return name if isinstance(name, str) and name else 'an unknown tool'


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


def written_paths(data, dialect):
    """The absolute paths the tool call writes, dialect by dialect. An empty list for a
    call that writes no file. Raises Fault when a file tool's input names no path."""
    # dialect: claude
    if dialect == 'claude':
        return [written_path_claude(data)]
    # dialect: antigravity
    # dialect: codex
    # dialect: opencode
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
    # dialect: codex
    # dialect: opencode
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
    STATE['tool'] = tool_name(data)
    path = written_paths(data, arguments['--dialect'])[0]
    STATE['path'] = path
    allowed = []
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
    # dialect: claude
    if dialect != 'claude':
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
