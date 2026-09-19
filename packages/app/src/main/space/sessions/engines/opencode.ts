/**
 * The OpenCode adapter. Its `capability` and `options` are real (M10.5,
 * `m10-architecture.md` 3.6); `launch` is a stub until M10.8 builds it.
 */

import { OPENCODE_OPTIONS } from '../engine-options.js';
import type { EngineAdapter } from './types.js';

const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'yes',
    text: "Reads the Lore's instructions, and its verbs as commands (/<name>).",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: "File edits are checked by the write-guard through a plugin; shell commands follow the session's permission rules, merged with your own OpenCode configuration.",
  },
};

export const opencodeAdapter: EngineAdapter = {
  catalogId: 'opencode',
  capability: CAPABILITY,
  options: OPENCODE_OPTIONS,
  skillInvocation: (name) => `/${name}`,
  verbsAre: 'invoked',
  launch() {
    throw new Error('the OpenCode adapter is not built yet');
  },
};
