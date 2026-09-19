/**
 * The Antigravity CLI adapter. Its `capability` and `options` are real (M10.5,
 * `m10-architecture.md` 3.6); `launch` is a stub until M10.6 builds it.
 */

import { ANTIGRAVITY_OPTIONS } from '../engine-options.js';
import type { EngineAdapter } from './types.js';

const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'yes',
    text: "Reads the Lore's instructions as a rule, and its verbs as skills.",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: 'File edits are checked by the write-guard; shell commands are checked by their text, your own Antigravity permissions still apply, and a failed Lore check after a write is not reported to the session.',
  },
};

export const antigravityAdapter: EngineAdapter = {
  catalogId: 'antigravity',
  capability: CAPABILITY,
  options: ANTIGRAVITY_OPTIONS,
  skillInvocation: (name) => `/${name}`,
  verbsAre: 'invoked',
  launch() {
    throw new Error('the Antigravity CLI adapter is not built yet');
  },
};
