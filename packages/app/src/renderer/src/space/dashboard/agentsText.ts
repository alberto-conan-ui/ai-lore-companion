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

function count(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** A duration in words, rounded down: "3 hours", "2 days". */
export function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return count(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return count(hours, 'hour');
  return count(Math.floor(hours / 24), 'day');
}

/** Open an issue on GitHub in the system's browser. */
export function openIssue(issue: IssueRef): void {
  void window.cockpit.urlOpenExternal(issue.url);
}
