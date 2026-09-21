import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../../src/renderer/src/space/dashboard/v2/format.js';

describe('relativeTime', () => {
  it('returns "today" for the same calendar day', () => {
    const now = new Date('2026-09-21T15:00:00Z').getTime();
    expect(relativeTime('2026-09-21T08:00:00Z', now)).toBe('today');
  });

  it('returns "yest. HH:MM" for the previous calendar day', () => {
    const now = new Date('2026-09-21T15:00:00Z').getTime();
    const iso = '2026-09-20T19:40:00Z';
    const date = new Date(iso);
    const expected = `yest. ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('returns "since Month Year" format for older dates (>30 days)', () => {
    const now = new Date('2026-09-21T15:00:00Z').getTime();
    const iso = '2026-06-15T10:00:00Z';
    const date = new Date(iso);
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();
    expect(relativeTime(iso, now)).toBe(`since ${month} ${year}`);
  });

  it('returns "N days ago" format for 2-30 days', () => {
    const now = new Date('2026-09-21T15:00:00Z').getTime();
    const iso = '2026-09-10T10:00:00Z'; // 11 days ago
    expect(relativeTime(iso, now)).toBe('11 days ago');
  });

  it('returns "today" for future dates', () => {
    const now = new Date('2026-09-21T15:00:00Z').getTime();
    const iso = '2026-09-22T10:00:00Z';
    expect(relativeTime(iso, now)).toBe('today');
  });
});
