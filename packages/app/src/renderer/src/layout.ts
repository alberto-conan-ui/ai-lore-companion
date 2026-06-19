/**
 * Column-layout math for the nav | editor | centre trio (Read-only IDE P2).
 *
 * The widths are kept in pixels (the sashes drag them, layout-capture persists
 * them), but two behaviours are proportional:
 *   - **Opening the editor** gives it an equal third of the trio; the nav and
 *     centre keep their pre-open ratio in the remaining two-thirds.
 *   - **Resizing the window** preserves all three proportions.
 *
 * Both reduce to simple scalar math, isolated here so it can be unit-tested
 * without mounting the whole workspace.
 */

/**
 * Equal-third reflow when the editor opens. The editor takes `avail / 3`; the
 * nav and centre split the remaining two-thirds in their existing ratio — which
 * means the nav simply shrinks to two-thirds of its current content width (the
 * centre, as the flexed remainder, keeps the rest). Preserves nav : centre for
 * any starting split:
 *   - 50 / 50  → nav 1/3, editor 1/3, centre 1/3
 *   - 75 / 25  → nav 1/2, editor 1/3, centre 1/6  (still 3 : 1)
 *
 * `navContent` is the nav column without the fixed activity rail; `avail` is the
 * trio's total content width. Returns the nav-content and editor target widths
 * (the centre flexes to whatever remains).
 */
export function reflowEditorThirds(
  avail: number,
  navContent: number,
): { nav: number; editor: number } {
  return { nav: (navContent * 2) / 3, editor: avail / 3 };
}

/**
 * Scale a pixel width by the change in available width, so a column keeps its
 * fraction of the trio across a window resize. Applied to the nav content and
 * the editor alike; the centre, being the flexed remainder, then also keeps its
 * fraction. A non-finite or non-positive ratio is a no-op (returns the input).
 */
export function scaleForResize(value: number, prevAvail: number, nextAvail: number): number {
  if (prevAvail <= 0 || nextAvail <= 0) return value;
  const k = nextAvail / prevAvail;
  return Number.isFinite(k) ? value * k : value;
}
