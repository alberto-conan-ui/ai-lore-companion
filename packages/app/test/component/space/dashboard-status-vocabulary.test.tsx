import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  StageMark,
  StatusDot,
} from '../../../src/renderer/src/space/dashboard/v2/statusVocabulary.js';

describe('statusVocabulary', () => {
  it('StageMark pairs every shape with a word and hides the shape', () => {
    const shapes = ['build', 'spec', 'queued', 'dormant'] as const;
    for (const shape of shapes) {
      const { container, unmount } = render(<StageMark shape={shape} word="test-word" />);
      const shapeSpan = container.querySelector('[aria-hidden="true"]');
      expect(shapeSpan).not.toBeNull();

      const wordSpan = screen.getByText('test-word');
      expect(wordSpan).not.toBeNull();
      unmount();
    }
  });

  it('StatusDot pairs the colour with a word and hides the dot', () => {
    const tones = ['accent', 'red', 'muted'] as const;
    for (const tone of tones) {
      const { container, unmount } = render(<StatusDot tone={tone} word="test-word" />);
      const dotSpan = container.querySelector('[aria-hidden="true"]');
      expect(dotSpan).not.toBeNull();

      const wordSpan = screen.getByText('test-word');
      expect(wordSpan).not.toBeNull();
      unmount();
    }
  });
});
