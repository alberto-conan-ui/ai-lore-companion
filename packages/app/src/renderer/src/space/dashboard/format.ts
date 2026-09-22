import type { CSSProperties } from 'react';

/** A duration in words, rounded down: 3 hours, 2 days. */
export function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}

export const linkStyle: CSSProperties = {
  marginTop: '0.3rem',
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-link)',
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
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(nowDate.getTime()))
    return 'time unknown';
  if (date.getTime() > nowDate.getTime()) return 'just now';
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const diffDays = Math.round((nowMidnight.getTime() - dateMidnight.getTime()) / 86400000);

  if (diffDays <= 0) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `today ${hh}:${mm}`;
  }
  if (diffDays === 1) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `yest. ${hh}:${mm}`;
  }
  if (diffDays > 30) {
    return `since ${date.toLocaleString('en-US', { month: 'long' })} ${date.getFullYear()}`;
  }
  return `${String(diffDays)} days ago`;
}
