/**
 * Per-project accent colour. A project's name hashes to a stable hue; the
 * cockpit wears that hue — the header tint and stripe, the dock handles — so
 * windows for different projects are unmistakable at a glance.
 */

/** The project's name — the last segment of its root path. */
export function projectName(root: string): string {
  const segs = root.split('/').filter(Boolean);
  return segs[segs.length - 1] ?? root;
}

/** A stable hue (0–359) for a project name — the same name always yields the same one. */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** The bright accent colour at a project hue. */
export function accentColor(hue: number): string {
  return `hsl(${hue}, 70%, 58%)`;
}

/** The dark, low-saturation background tint at a project hue (dark theme). */
export function accentTint(hue: number): string {
  return `hsl(${hue}, 32%, 12%)`;
}

/** The light background tint at a project hue (light theme) — the same hue, at
 *  high lightness so the header/dock read as a soft wash rather than near-black. */
export function accentTintLight(hue: number): string {
  return `hsl(${hue}, 52%, 91%)`;
}
