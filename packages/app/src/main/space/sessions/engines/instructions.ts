/**
 * The session instructions every engine gets (phase M10.5, `m10-architecture.md`
 * 3.3). This is a change for Claude Code, which gets no instruction today; the
 * Human Lead accepted it (answer 8 of section 1).
 */

import type { InstalledSkill } from './skills.js';
import type { EngineAdapter } from './types.js';

export function sessionInstructions(input: {
  spaceRoot: string;
  skills: readonly InstalledSkill[];
  adapter: Pick<EngineAdapter, 'skillInvocation' | 'verbsAre'>;
  /** The PM is still an ordinary attended, guarded session; this only gives it its remit. */
  purpose?: 'pm' | 'dashboard-refresh';
  /** Resolved PM and Dashboard corpus cards, falling back to the shipped defaults for older Spaces. */
  pmCorpusPaths?: readonly string[];
  /** The Space's Lore is standard files (`standard-lore.ts`): no modes, no claims, no plugin skills. */
  standardLore?: boolean;
}): string {
  const { spaceRoot, skills, adapter, purpose, pmCorpusPaths = [], standardLore = false } = input;
  if (standardLore) {
    // The skills come from the Space's own files (`.agents/skills`, and the engine's link to
    // them), which the engine reads by itself, so they are not listed here.
    return `${[
      `This session was started by the AI-Lore companion in a Space whose folder is ${spaceRoot}. The Space has an AGENTS.md: its Lore is standard files, and the modes of AI-Lore 1.0 do not apply.`,
      `Read ${spaceRoot}/AGENTS.md first and follow it.`,
      "There is no Read only and no Writing, and nothing is claimed: do not call request_writing or leave_writing. Work on a branch for each piece of work and open a pull request. The engine's settings, git and GitHub keep the work safe.",
      'The companion\'s tools for this session come from the MCP server "ailore": request_gate and await_answer ask the Human Lead a question and wait for the answer; get_dashboard_context and request_dashboard_update serve the dashboard.',
    ].join('\n')}\n`;
  }
  const lines = [
    `This session was started by the AI-Lore companion in an AI-Lore 1.0 Space, whose folder is ${spaceRoot}.`,
    `Read ${spaceRoot}/ai_readme.md first and follow it. Then run the verb session-orient.`,
    `The session starts in Read only: it writes only to the Workbench (${spaceRoot}/workbench/) until the Human Lead confirms a claim.`,
    'The companion\'s tools for this session come from the MCP server "ailore": request_writing, request_gate, await_answer, leave_writing and get_dashboard_context. Ordinary sessions may also call request_dashboard_update; PM sessions may call report_dashboard with typed values.',
  ];
  if (purpose === 'pm' || purpose === 'dashboard-refresh') {
    lines.push(
      "You are this Space's Project Manager session. Keep the Human Lead in control: orient first, make the plan and current work legible, and ask rather than inventing decisions or authority.",
    );
    if (pmCorpusPaths.length > 0) {
      lines.push(
        `Read the PM and Dashboard corpus cards before coordinating work: ${pmCorpusPaths.join(', ')}.`,
      );
    }
  }
  if (adapter.verbsAre === 'invoked') {
    lines.push(
      `The verbs and processes of the Lore are invoked as ${adapter.skillInvocation('<name>')}, for example ${adapter.skillInvocation('session-orient')}.`,
    );
  } else {
    lines.push(
      'The verbs and processes of the Lore are these. To run one, read its card at the path given and follow it:',
    );
    for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${skill.name}: ${skill.description} (${skill.cardPath})`);
    }
  }
  return `${lines.join('\n')}\n`;
}
