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
}): string {
  const { spaceRoot, skills, adapter, purpose, pmCorpusPaths = [] } = input;
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
