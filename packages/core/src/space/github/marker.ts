/**
 * Issue markers: the hidden line in an issue's body by which a caller finds
 * the issue it created before, so that running again creates nothing twice.
 *
 * A marker is one HTML comment, `<!-- ai-lore-<name>: <key> -->`, alone on a
 * line of the body. GitHub does not render it. `name` says who made the issue
 * (`migrated`, `session`); `key` says which one (a source path, a session id).
 * The key is percent-encoded, so a marker holds no space inside the key, no
 * `>` and no `--`, and one marker is never part of another.
 *
 * A body has a marker only when a whole line is the marker and the line is
 * outside a fenced code block. An issue that quotes a marker in a sentence, in
 * inline code, in a quotation or in a code block therefore does not have it.
 * The gh adapter and `FakeGitHub` both decide with `bodyHasMarker`.
 */

const MARKER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MARKER = /^<!-- ai-lore-[a-z][a-z0-9]*(?:-[a-z0-9]+)*: [^\s<>]+ -->$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The marker for `key` under `name`. `name` is lower-case words joined by `-`;
 * `key` is any text that is not empty. Throws a `TypeError` for another
 * `name` or an empty `key`, which is a mistake in the calling code.
 */
export function formatIssueMarker(name: string, key: string): string {
  if (!MARKER_NAME.test(name)) throw new TypeError(`${name} is not a marker name`);
  if (key === '') throw new TypeError('a marker needs a key');
  const encoded = encodeURIComponent(key)
    .replace(/%2F/g, '/')
    // An HTML comment may not hold `--`: a hyphen that follows a hyphen is written as its code.
    .replace(/(?<=-)-/g, '%2D');
  return `<!-- ai-lore-${name}: ${encoded} -->`;
}

/** Whether `text` has the form `formatIssueMarker` gives. */
export function isIssueMarker(text: string): boolean {
  return MARKER.test(text) && !text.slice(5, -4).includes('--');
}

/** Whether a line of `body`, outside a fenced code block, is exactly `marker`. */
export function bodyHasMarker(body: string, marker: string): boolean {
  let fence: string | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/[ \t\r]+$/, '');
    const opening = FENCE.exec(line)?.[1];
    if (fence !== null) {
      // A fence closes on a line of the same character, at least as long, with nothing after it.
      const closes =
        opening !== undefined &&
        opening[0] === fence[0] &&
        opening.length >= fence.length &&
        line.trim() === opening;
      if (closes) fence = null;
      continue;
    }
    if (opening !== undefined) {
      fence = opening;
      continue;
    }
    if (line === marker) return true;
  }
  return false;
}
