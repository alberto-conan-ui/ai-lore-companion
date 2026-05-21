const MODE_ROW = /\|\s*\*\*Mode\*\*\s*\|\s*([^\|]+?)\s*\|/i;
const ACTIVE_FOCUS_ROW = /\|\s*\*\*Active focus\*\*\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|/i;
const ACTIVE_CHILD_BLOCK = /##\s+Active child pointer\s*\n+([\s\S]*?)(?=\n##\s|$)/i;
const FIRST_MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
const LEAF_MARKER = /\(leaf\b/i;
const HEADLESS_MARKER = /headless/i;
export function parseMode(text) {
    const m = text.match(MODE_ROW);
    return m?.[1]?.trim() ?? null;
}
export function parseActiveFocus(text) {
    const m = text.match(ACTIVE_FOCUS_ROW);
    if (!m?.[1] || !m[2])
        return null;
    const title = m[1].trim();
    const linkBody = m[2].trim();
    if (HEADLESS_MARKER.test(linkBody) || HEADLESS_MARKER.test(title))
        return null;
    return { title, relPath: linkBody };
}
export function parseActiveChild(text) {
    const block = text.match(ACTIVE_CHILD_BLOCK);
    if (!block?.[1])
        return null;
    const body = block[1];
    if (LEAF_MARKER.test(body))
        return null;
    const link = body.match(FIRST_MD_LINK);
    if (!link?.[1] || !link[2])
        return null;
    return { title: link[1].trim(), relPath: link[2].trim() };
}
export function isStatusHeadless(text) {
    return HEADLESS_MARKER.test(text);
}
export function asNodeRef(absPath, title) {
    return { title, path: absPath };
}
//# sourceMappingURL=parse.js.map