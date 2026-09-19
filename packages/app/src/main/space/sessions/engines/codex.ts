/**
 * The Codex CLI adapter. Its `capability` and `options` are real (M10.5,
 * `m10-architecture.md` 3.6); `launch` is a stub until M10.7 builds it.
 */

import { CODEX_OPTIONS } from '../engine-options.js';
import type { EngineAdapter } from './types.js';

const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'partly',
    text: "Reads the Lore's instructions; the verbs are listed in them and are not commands.",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: "File edits are checked by the write-guard; shell commands run in Codex's read-only sandbox and ask you before they write; your own Codex configuration still applies.",
  },
};

export const codexAdapter: EngineAdapter = {
  catalogId: 'codex',
  capability: CAPABILITY,
  options: CODEX_OPTIONS,
  skillInvocation: (name) => `Run the Lore's ${name}: read its card and follow it.`,
  verbsAre: 'listed',
  launch() {
    throw new Error('the Codex CLI adapter is not built yet');
  },
};
