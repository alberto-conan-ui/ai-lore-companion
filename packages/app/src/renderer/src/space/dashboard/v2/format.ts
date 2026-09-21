import type { CSSProperties } from 'react';

/** A duration in words, rounded down: "3 hours", "2 days". */
export function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export const linkStyle: CSSProperties = {
  marginTop: '0.3rem',
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--d-accent, #5a9bd4)',
  fontSize: '0.75rem',
  textDecoration: 'underline',
  cursor: 'pointer',
};

export function openLink(url: string): void {
  void window.cockpit.urlOpenExternal(url);
}

export function relativeTime(iso: string, now: number): string {
  const date = new Date(iso);
  const nowDate = new Date(now);

  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const diffDays = Math.round((nowMidnight.getTime() - dateMidnight.getTime()) / 86400000);

  if (diffDays === 0) {
    return 'today';
  }
  if (diffDays === 1) {
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    return `yest. ${hh}:${mm}`;
  }
  if (diffDays > 30) {
    const month = date.toLocaleString('en-US', { month: 'long' });
    return `since ${month}`;
  }
  return `${diffDays} days ago`;
}
