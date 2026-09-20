/**
 * The follow-up note (phase M6.7, section "Migration" of the focus, amended
 * 2026-09-20): what the migration gathered and created but did not finish,
 * for an AI session in the new Space to read and act on. Step 13 writes it to
 * `FOLLOW_UP_NOTE_PATH` after the verification passes.
 *
 * `followUpNoteText` reads only `ctx.source`, `ctx.repositoryName`,
 * `ctx.issues` and the ledger's `issue` records; it writes nothing and is
 * deterministic, so a second run of the same migration reproduces it byte for
 * byte. No timestamp and no run-specific id appear in it.
 */

import type { MigrationContext } from './context.js';
import { ledgerRecords } from './ledger.js';
import { archivedPath } from './targets.js';
import type { MigrationIssueKind } from './types.js';

/** Where the note is written, Space-relative, under the gitignored Workbench. */
export const FOLLOW_UP_NOTE_PATH = 'workbench/migration-follow-up.md';

const KIND_WORDS: Record<MigrationIssueKind, string> = {
  focus: 'focus',
  stage: 'stage',
  'paused-focus': 'paused focus',
  backlog: 'backlog item',
};

/** The line for one issue: its `repository#number`, title, kind and archived source. */
function issueLine(
  issue: MigrationContext['issues'][number],
  found: Map<string, { repository: string; number: number }>,
): string {
  const ref = found.get(issue.key);
  const locator = ref === undefined ? 'not found in the ledger' : `${ref.repository}#${ref.number}`;
  return `- ${locator} — ${issue.title} (${KIND_WORDS[issue.kind]}), archived at \`${issue.archived}\``;
}

/**
 * The note's text: what the migration created from a v0.8 project, the
 * Project's Status mapping for the session to apply, and every issue with
 * where it came from. Pure: reads no file and writes nothing.
 */
export function followUpNoteText(ctx: MigrationContext): string {
  const found = new Map(ledgerRecords(ctx, 'issue').map((record) => [record.key, record.issue]));
  const statusStack = archivedPath(ctx.source, 'memory/status/status.stack.md');
  const statusDir = archivedPath(ctx.source, 'memory/status');

  const lines = [
    `# The follow-up from the migration of ${ctx.source.project.name}`,
    '',
    `The migration created this Space, \`${ctx.repositoryName}\`, from the v0.8 project "${ctx.source.project.name}". What follows is what code did not carry.`,
    '',
    "## The Project's Status",
    '',
    `Every issue on the Project arrived as \`Todo\` and open. Each one's true status is in the archive: the focuses in \`${statusStack}\`, and each stage's \`status:\` frontmatter under \`${statusDir}\`.`,
    '',
    'The mapping to apply: `done` becomes Status `Done` and the issue is closed; `in progress` becomes `In Progress`; `draft`, `paused` and an unreadable status become `Todo`. A paused focus keeps its `paused` label, which carries what Status cannot. The `Stage` field stays on the focus issue alone, because a v0.8 stage records no Stage and any value for a stage issue would be invented.',
    '',
    '## The issues this migration created',
    '',
    ...ctx.issues.map((issue) => issueLine(issue, found)),
    '',
    'This note is a record of the handover. It can be deleted once the work above is done.',
    '',
  ];
  return lines.join('\n');
}
