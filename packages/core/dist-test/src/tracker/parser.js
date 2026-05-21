/**
 * Parser for the project-local Status metadata convention.
 * See knowledge-tree/working/cockpit-design/status-convention.spec.md.
 */
const STATUS_LINE = /^>\s*\*\*Status:\*\*\s*(\w+)\s*$/m;
const H1_LINE = /^#\s+(.+?)\s*$/m;
const VOCAB = new Set(['Pending', 'Active', 'Paused', 'Review', 'Done', 'Achieved']);
/** Returns the Status word, or null if no Status block is present or the value is not in vocab. */
export function parseStatus(fileText) {
    const match = fileText.match(STATUS_LINE);
    const raw = match?.[1]?.trim();
    if (!raw)
        return null;
    // Vocabulary check is intentionally case-sensitive — the convention specifies titlecase.
    return VOCAB.has(raw) ? raw : null;
}
export function parseTitle(fileText) {
    const match = fileText.match(H1_LINE);
    return match?.[1]?.trim() ?? null;
}
//# sourceMappingURL=parser.js.map