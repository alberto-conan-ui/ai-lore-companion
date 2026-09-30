import type { SpacePlansState, SpacePlansUnit } from '../../../../shared/ipc.js';

/** The words of the Plans band, in one place so the band and its tests say the same things. */

export const PLANS_FOOTER = 'Each row opens its dashboard. Changes show within a minute';

/** The footer: the promise, qualified by what the tool says can take longer (its `note`), as one sentence. */
export function footerText(state: SpacePlansState | null): string {
  const note = state?.note ?? '';
  return `${PLANS_FOOTER}${note === '' ? '.' : `, ${note}.`}`;
}

/** `Ns ago`, `Nm ago`, `Nh ago`, `Nd ago`; `just now` for a time not yet reached (clocks differ by a little). */
export function agoText(ms: number, now: number): string {
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return 'time unknown';
  const seconds = Math.floor((now - ms) / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/** What a row says of when its unit was last changed. An unread time is said as unread, never as a moment. */
export function updatedText(unit: SpacePlansUnit, now: number): string {
  if (unit.updated === null) return 'updated: not read';
  const ago = agoText(unit.updated, now);
  return unit.updatedExact ? `updated ${ago}` : `updated ${ago} or later`;
}

export function kindLabel(kind: SpacePlansUnit['kind']): string {
  return kind === 'sub-epic' ? 'SUB-EPIC' : kind.toUpperCase();
}

/** The clear line at the right of the band's heading. */
export function headingState(state: SpacePlansState | null, now: number, active = true): string {
  if (state === null || state.outcome === null) return active ? 'READING' : 'NOT READ YET';
  const reading = state.reading ? ' · READING' : '';
  switch (state.outcome) {
    case 'complete': {
      const count = state.units?.length ?? 0;
      const read =
        state.readAt === null ? '' : ` · READ ${agoText(state.readAt, now).toUpperCase()}`;
      return `${String(count)} ${count === 1 ? 'PLAN' : 'PLANS'}${read}${reading}`;
    }
    case 'incomplete': {
      const read =
        state.readAt === null ? '' : ` · READ ${agoText(state.readAt, now).toUpperCase()}`;
      return `INCOMPLETE${read}${reading}`;
    }
    case 'refused':
      return `REFUSED${reading}`;
    case 'unreachable':
      return `NOT REACHABLE${reading}`;
    case 'failed':
      return `NOT READ${reading}`;
    default:
      return '';
  }
}

/** The last read that answered, said beside a read that did not: a time, never a list. */
export function lastReadText(state: SpacePlansState, now: number): string {
  if (state.lastReadAt === null) return 'No read has answered yet.';
  const at = new Date(state.lastReadAt);
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `The last read that answered was at ${hh}:${mm} (${agoText(state.lastReadAt, now)}). It is not shown.`;
}
