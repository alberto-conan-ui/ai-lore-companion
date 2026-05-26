/**
 * Parse a Memory file body into named H2 sections.
 *
 * AI-Lore Memory files (focus, at-node, status, ...) have a recurring shape:
 * a body opens with optional prose (often a `> **Status:** …` quote), then a
 * sequence of `## <Section Name>` headings each owning the text that follows
 * until the next H2 or end-of-body.
 *
 * The parser returns a `Record<string, string>` keyed by the H2 label (with
 * the leading `##` stripped and surrounding whitespace trimmed); section
 * values keep their inner newlines but are trimmed at both ends. Sections
 * that do not appear in the body are simply absent — empty body is a valid
 * result.
 *
 * The parser is intentionally generic: it does not know about "Gate" vs
 * "Vision" vs "Context". The renderer picks which keys it cares about based
 * on `focus_type` or `node_kind`.
 */
export type MemorySections = Record<string, string>;

const H2_LINE = /^##\s+(.+?)\s*$/;

export function parseMemorySections(body: string): MemorySections {
  const sections: MemorySections = {};
  const lines = body.split('\n');

  let currentKey: string | null = null;
  let currentBuf: string[] = [];

  const flush = (): void => {
    if (currentKey !== null) {
      sections[currentKey] = currentBuf.join('\n').trim();
    }
    currentKey = null;
    currentBuf = [];
  };

  for (const line of lines) {
    const heading = line.match(H2_LINE);
    if (heading) {
      flush();
      currentKey = heading[1] ?? '';
      currentBuf = [];
      continue;
    }
    if (currentKey !== null) currentBuf.push(line);
  }
  flush();

  return sections;
}

/**
 * Lookup a section by label, case-insensitively. The methodology's labels are
 * authored Title Case in some files and Sentence case in others; callers
 * should not have to know which.
 */
export function findSection(sections: MemorySections, label: string): string | undefined {
  const target = label.toLowerCase();
  for (const [key, value] of Object.entries(sections)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}
