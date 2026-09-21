import type { JSX } from 'react';

export type CappedItems<T> = {
  visible: readonly T[];
  hiddenCount: number;
};

/** Caps the rendered list. The caller owns the full list and can open it from the footer. */
export function capItems<T>(items: readonly T[], limit: number): CappedItems<T> {
  const count = Math.max(0, Math.floor(limit));
  return {
    visible: items.slice(0, count),
    hiddenCount: Math.max(0, items.length - count),
  };
}

type Props = {
  hiddenCount: number;
  noun?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function OverflowFooter({
  hiddenCount,
  noun = 'items',
  actionLabel,
  onAction,
}: Props): JSX.Element | null {
  if (hiddenCount <= 0) return null;
  const text = `+${hiddenCount} more${noun.length === 0 ? '' : ` ${noun}`}`;
  return (
    <div className="dashboard-v2-overflow-footer" data-testid="dashboard-v2-overflow">
      {actionLabel !== undefined && onAction !== undefined ? (
        <button type="button" onClick={onAction}>
          {text} · {actionLabel}
        </button>
      ) : (
        <span>{text}</span>
      )}
    </div>
  );
}
