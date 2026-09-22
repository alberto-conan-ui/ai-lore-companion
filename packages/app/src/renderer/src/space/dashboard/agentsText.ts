import type { AgentsColumn, IssueRef } from '@ai-lore-companion/core';

/**
 * Text and actions shared by the Agents board, Needs you and Start a session
 * (phase M7.4). The renderer imports types only from core, so the four columns
 * of the Agents board are repeated here in core's order (`AGENTS_COLUMNS`).
 */
export const BOARD_COLUMNS: readonly AgentsColumn[] = ['Read only', 'Writing', 'Blocked', 'Done'];

/** An issue as it is named in the Dashboard: `owner/name#12`. */
export function issueName(issue: IssueRef): string {
  return `${issue.repository}#${issue.number}`;
}

/** Open an issue on GitHub in the system's browser. */
export function openIssue(issue: IssueRef): void {
  void window.cockpit.urlOpenExternal(issue.url);
}
