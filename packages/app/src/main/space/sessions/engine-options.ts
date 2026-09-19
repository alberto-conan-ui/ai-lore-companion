/**
 * The reserved and guard-changing options of each engine (M10.3,
 * `m10-architecture.md` 3.5). The adapters do not exist yet (M10.5 adds
 * them), so this file holds the four constants directly; `optionsFor` looks
 * them up by the engine's catalog id.
 */

import { type EngineEntry, catalogEntryFor, isClaudeEngine } from '@ai-lore-companion/core';

/**
 * The options of one engine: set by the companion (a parameter holding one is
 * refused), and changing the guard (the session is unguarded).
 */
export type EngineOptions = { reserved: readonly string[]; guardChanging: readonly string[] };

export const CLAUDE_CODE_OPTIONS: EngineOptions = {
  reserved: [
    '--settings',
    '--setting-sources',
    '--mcp-config',
    '--strict-mcp-config',
    '--plugin-dir',
    '--allowedTools',
    '--allowed-tools',
    '--append-system-prompt',
    '--bare',
    '--safe-mode',
  ],
  guardChanging: [
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    '--permission-mode',
    '--permission-prompt-tool',
    '--tools',
    '--add-dir',
  ],
};

// --dangerously-skip-permissions is not guard-changing for Antigravity: the Lore's
// PreToolUse hook was observed to refuse writes with it on (m10-architecture.md 2.3).
// M10.9 re-confirms it.
export const ANTIGRAVITY_OPTIONS: EngineOptions = {
  reserved: ['--print', '-p', '--prompt', '--output-format', '--input-format'],
  guardChanging: ['--mode', '--add-dir'],
};

export const CODEX_OPTIONS: EngineOptions = {
  reserved: ['--dangerously-bypass-hook-trust', 'exec', 'e'],
  guardChanging: [
    '--dangerously-bypass-approvals-and-sandbox',
    '--yolo',
    '-s',
    '--sandbox',
    '-a',
    '--ask-for-approval',
    '--add-dir',
    '-p',
    '--profile',
    '--enable',
    '--disable',
    '--approve-for-me',
    '-C',
    '--cd',
    '--remote',
    '--remote-auth-token-env',
  ],
};

export const OPENCODE_OPTIONS: EngineOptions = {
  reserved: ['run', 'serve', 'web'],
  guardChanging: ['--auto', '--agent', '--pure'],
};

/**
 * The options of `engine`: by its catalog id, or `CLAUDE_CODE_OPTIONS` for a
 * hand-added Claude Code (`isClaudeEngine`); `null` for any other engine.
 * M10.5 replaces the body with `adapterFor(engine)?.options ?? null`.
 */
export function optionsFor(engine: EngineEntry): EngineOptions | null {
  const catalog = catalogEntryFor(engine);
  if (catalog !== null) {
    switch (catalog.catalogId) {
      case 'claude-code':
        return CLAUDE_CODE_OPTIONS;
      case 'antigravity':
        return ANTIGRAVITY_OPTIONS;
      case 'codex':
        return CODEX_OPTIONS;
      case 'opencode':
        return OPENCODE_OPTIONS;
    }
  }
  if (isClaudeEngine(engine)) return CLAUDE_CODE_OPTIONS;
  return null;
}

export type ParamEffect = { effect: 'none' | 'unguarded' | 'refused'; options: string[] };

/** The name of `argument`: itself, or the part before `=` in its `<option>=value` form. */
function optionNameOf(argument: string): string {
  const at = argument.indexOf('=');
  return at === -1 ? argument : argument.slice(0, at);
}

function matches(option: string, argument: string): boolean {
  return argument === option || argument.startsWith(`${option}=`);
}

/**
 * For Codex, `-c` and `--config` are guard-changing unless the key of their
 * value is `model` or `model_reasoning_effort` (the value is the next
 * argument, or the text after `=`).
 */
function codexConfigEffect(argv: readonly string[], index: number): 'none' | 'unguarded' {
  const argument = argv[index] as string;
  const inline = argument.indexOf('=');
  const value = inline !== -1 ? argument.slice(inline + 1) : (argv[index + 1] ?? '');
  const key = value.split('=')[0] ?? '';
  return key === 'model' || key === 'model_reasoning_effort' ? 'none' : 'unguarded';
}

/**
 * What the argument list of one parameter does under `options`. `options` of
 * the result are option names without `=value`. `refused` wins over
 * `unguarded`. For `options` null, the effect is `none`.
 */
export function paramEffect(options: EngineOptions | null, argv: readonly string[]): ParamEffect {
  if (options === null) return { effect: 'none', options: [] };
  const refusedNames = new Set<string>();
  const unguardedNames = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const name = optionNameOf(argument);
    if (options.reserved.some((option) => matches(option, argument))) {
      refusedNames.add(name);
      continue;
    }
    if (options === CODEX_OPTIONS && (matches('-c', argument) || matches('--config', argument))) {
      if (codexConfigEffect(argv, index) === 'unguarded') unguardedNames.add(name);
      continue;
    }
    if (options.guardChanging.some((option) => matches(option, argument))) {
      unguardedNames.add(name);
    }
  }
  if (refusedNames.size > 0) return { effect: 'refused', options: [...refusedNames] };
  if (unguardedNames.size > 0) return { effect: 'unguarded', options: [...unguardedNames] };
  return { effect: 'none', options: [] };
}
