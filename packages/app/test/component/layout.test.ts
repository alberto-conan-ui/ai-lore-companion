import { describe, expect, it } from 'vitest';
import { reflowEditorThirds, scaleForResize } from '../../src/renderer/src/layout.js';

describe('reflowEditorThirds — editor opens', () => {
  it('a balanced 50/50 split becomes even thirds', () => {
    const avail = 1200;
    const { nav, editor } = reflowEditorThirds(avail, 600); // nav was half
    const centre = avail - nav - editor;
    expect(editor).toBe(400);
    expect(nav).toBe(400);
    expect(centre).toBe(400);
  });

  it('a 75/25 split keeps its ratio while the editor takes a third', () => {
    const avail = 1200;
    const { nav, editor } = reflowEditorThirds(avail, 900); // nav was three-quarters
    const centre = avail - nav - editor;
    expect(editor).toBe(400); // a third
    expect(nav).toBe(600); // half
    expect(centre).toBe(200); // a sixth
    // nav : centre stays 3 : 1.
    expect(nav / centre).toBeCloseTo(3);
  });

  it('preserves nav:centre for an arbitrary split', () => {
    const avail = 1000;
    const navBefore = 300; // 30 / 70
    const { nav, editor } = reflowEditorThirds(avail, navBefore);
    const centre = avail - nav - editor;
    expect(editor).toBeCloseTo(avail / 3);
    expect(nav / centre).toBeCloseTo(navBefore / (avail - navBefore));
  });
});

describe('scaleForResize — window resize preserves proportions', () => {
  it('scales a width by the available-width ratio', () => {
    expect(scaleForResize(400, 1200, 1500)).toBe(500);
    expect(scaleForResize(400, 1200, 600)).toBe(200);
  });

  it('keeps all three fractions constant across a resize', () => {
    const prev = 1200;
    const next = 1500;
    const nav = 400;
    const editor = 400;
    const centre = prev - nav - editor;
    const nav2 = scaleForResize(nav, prev, next);
    const editor2 = scaleForResize(editor, prev, next);
    const centre2 = next - nav2 - editor2;
    expect(nav2 / next).toBeCloseTo(nav / prev);
    expect(editor2 / next).toBeCloseTo(editor / prev);
    expect(centre2 / next).toBeCloseTo(centre / prev);
  });

  it('is a no-op for a degenerate available width', () => {
    expect(scaleForResize(400, 0, 1500)).toBe(400);
    expect(scaleForResize(400, 1200, 0)).toBe(400);
  });
});
