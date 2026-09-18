import type { FocusCard, ItemCard } from '@ai-lore-companion/core';
import type { SpaceProjectState } from '../../../../shared/ipc.js';

/**
 * The sentences of the Dashboard (phase M7.3), as pure functions so that
 * component tests and the components say the same thing. Everything they say
 * comes from the push; nothing is read or computed from elsewhere.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An age in words: "less than a minute", "1 minute", "3 hours", "2 days". */
export function formatAge(ms: number): string {
  const unit = (count: number, name: string): string => `${count} ${name}${count === 1 ? '' : 's'}`;
  if (ms < MINUTE) return 'less than a minute';
  if (ms < HOUR) return unit(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return unit(Math.floor(ms / HOUR), 'hour');
  return unit(Math.floor(ms / DAY), 'day');
}

/** A time as the Human Lead's locale writes it, or the text as given when it cannot be read. */
export function formatTime(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString();
}

/** "read at <time>, <age> ago", or `null` when there is no read. */
function lastRead(fetchedAt: string | null, now: number): string | null {
  if (fetchedAt === null) return null;
  const at = Date.parse(fetchedAt);
  const age = Number.isNaN(at) ? '' : `, ${formatAge(Math.max(0, now - at))} ago`;
  return `${formatTime(fetchedAt)}${age}`;
}

/**
 * The sentence of the state line for a state of the Project cache:
 *
 * - fresh: when the snapshot was read;
 * - stale: the age of the snapshot, and the failure when there is one;
 * - offline: the failure sentence and the time of the last good read.
 */
export function stateSentence(project: SpaceProjectState, now: number): string {
  const read = lastRead(project.fetchedAt, now);
  const failure = project.failure
    ? ` The last refresh failed at ${formatTime(project.failure.at)}: ${project.failure.message}`
    : '';
  if (project.state === 'fresh') {
    return read === null ? 'Read from GitHub.' : `Read from GitHub at ${read}.`;
  }
  if (project.state === 'offline') {
    const last =
      read === null
        ? ' No read of the Project has succeeded.'
        : ` The last good read is from ${read}.`;
    return `GitHub could not be reached.${failure}${last}`;
  }
  const age =
    read === null
      ? 'No refresh has succeeded since the app opened this Space.'
      : `The shown Project was read from GitHub at ${read}.`;
  return `${age}${failure}`;
}

/** Why a focus is not in a Stage column. */
export function unstagedReason(card: FocusCard): string {
  return card.stage === null
    ? 'It has no Stage.'
    : `Its Stage "${card.stage}" is not an option of the Stage field.`;
}

/**
 * The label of a paused focus carried over by migration. The renderer imports
 * types only from core, so core's `PAUSED_LABEL` is repeated here.
 */
export const PAUSED_LABEL = 'paused';

/** Whether a focus is paused: its issue has the `paused` label. */
export function isPausedFocus(card: FocusCard): boolean {
  return card.labels.includes(PAUSED_LABEL);
}

/** "3 of 5 items done". */
export function itemsDoneText(card: FocusCard): string {
  return `${card.itemsDone} of ${card.itemsTotal} item${card.itemsTotal === 1 ? '' : 's'} done`;
}

/** The state of an item as its issue has it: "open" or "closed", its Status, done, paused. */
export function itemStateText(item: ItemCard): string {
  const parts: string[] = [
    item.state,
    item.status === null ? 'no Status' : `Status ${item.status}`,
  ];
  if (item.done) parts.push('done');
  if (item.paused) parts.push('paused');
  return parts.join(', ');
}
