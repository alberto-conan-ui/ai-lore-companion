import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StageMark,
  StatusDot,
} from '../../../src/renderer/src/space/dashboard/v2/statusVocabulary.js';

describe('v2 status vocabulary', () => {
  it('pairs each stage shape with an accessible word', () => {
    for (const shape of ['build', 'spec', 'queued', 'dormant'] as const) {
      const { container, unmount } = render(<StageMark shape={shape} word={shape.toUpperCase()} />);
      const mark = container.querySelector('[aria-hidden="true"]');
      expect(mark).not.toBeNull();
      expect(mark?.className).toContain(`dashboard-v2-stage-mark-${shape}`);
      expect(within(container).getByText(shape.toUpperCase())).toBeTruthy();
      unmount();
    }
  });

  it('pairs a coloured status dot with a word', () => {
    const { container } = render(<StatusDot tone="red" mark="✗" word="FAILED" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(within(container).getByText('FAILED')).toBeTruthy();
    expect(within(container).getByText('✗')).toBeTruthy();
  });
});
