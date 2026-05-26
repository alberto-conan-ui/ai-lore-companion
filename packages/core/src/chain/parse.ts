import { parseMemoryFile } from '../frontmatter/parser.js';
import type { MemoryFrontmatter } from '../frontmatter/types.js';
import type { NodeRef } from './types.js';

// Body-side fallbacks — used when frontmatter is absent (pre-v0.5 files) or
// to extract sections the methodology keeps in the body (active child pointer,
// the headless marker).
const ACTIVE_CHILD_BLOCK = /##\s+Active child pointer\s*\n+([\s\S]*?)(?=\n##\s|$)/i;
const FIRST_MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
const LEAF_MARKER = /\(leaf\b/i;
const HEADLESS_MARKER = /headless/i;

// Legacy v0.4 body row — kept for files that pre-date the frontmatter
// migration. v0.5 reads `active_focus:` directly from frontmatter.
const LEGACY_ACTIVE_FOCUS_ROW = /\|\s*\*\*Active focus\*\*\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|/i;
const LEGACY_MODE_ROW = /\|\s*\*\*Mode\*\*\s*\|\s*([^\|]+?)\s*\|/i;

/**
 * The conversational register the chain reader exposes. In v0.4 this was a
 * single "Mode" string; in v0.5 it is the posture plus the two dials. The
 * `mode` field is preserved on `ChainResult` for backwards compatibility
 * — Phase B replaces it with structured posture/dials in the IPC contract.
 */
export type ChainRegister = {
  /** v0.5 posture (`chat` / `plan` / `reshape` / `execute`), or null. */
  posture: string | null;
  /** v0.5 altitude (`low` / `mid` / `high`), or null. */
  altitude: string | null;
  /** v0.5 commitment (`go` / `neutral` / `challenge`), or null. */
  commitment: string | null;
};

/**
 * Read the conversational register from a status file. Prefers v0.5
 * frontmatter; falls back to the v0.4 "Mode" body row.
 */
export function parseRegister(text: string): ChainRegister {
  const parsed = parseMemoryFile(text);
  const fm = parsed.frontmatter;
  if (fm && fm.type === 'status') {
    return {
      posture: fm.posture,
      altitude: fm.dials.altitude,
      commitment: fm.dials.commitment,
    };
  }
  const legacy = text.match(LEGACY_MODE_ROW);
  return {
    posture: legacy?.[1]?.trim() ?? null,
    altitude: null,
    commitment: null,
  };
}

/**
 * Backwards-compatible string form of the register, populated for the
 * existing `mode` field on `ChainResult`. Returns the v0.5 posture when
 * available, the legacy "Mode" string otherwise, or `null` if neither is set.
 */
export function parseMode(text: string): string | null {
  const reg = parseRegister(text);
  return reg.posture;
}

/**
 * Resolve the active focus from a status file. Prefers v0.5 frontmatter
 * (`active_focus:` plus title resolved from the linked focus file's
 * frontmatter); falls back to the v0.4 "Active focus" body row.
 */
export function parseActiveFocus(text: string): { title: string; relPath: string } | null {
  const parsed = parseMemoryFile(text);
  const fm = parsed.frontmatter;
  if (fm && fm.type === 'status') {
    if (HEADLESS_MARKER.test(fm.active_focus)) return null;
    // Title comes from the linked focus file in v0.5 — the chain reader
    // walks one level into the focus file. Here we return the relative
    // path; reader.ts is responsible for reading the linked file's
    // `title:` frontmatter and using that as the displayed title.
    return { title: '', relPath: fm.active_focus };
  }
  const m = text.match(LEGACY_ACTIVE_FOCUS_ROW);
  if (!m?.[1] || !m[2]) return null;
  const title = m[1].trim();
  const linkBody = m[2].trim();
  if (HEADLESS_MARKER.test(linkBody) || HEADLESS_MARKER.test(title)) return null;
  return { title, relPath: linkBody };
}

/**
 * Read the active-child pointer from a focus or AT-node body. v0.5 keeps
 * this in the body, not the frontmatter — methodology preserves the
 * navigable markdown link.
 */
export function parseActiveChild(text: string): { title: string; relPath: string } | null {
  const { body } = parseMemoryFile(text);
  // Search the body if frontmatter parsed cleanly; otherwise search the
  // whole text (pre-v0.5 fallback).
  const haystack = body.length > 0 ? body : text;
  const block = haystack.match(ACTIVE_CHILD_BLOCK);
  if (!block?.[1]) return null;
  const blockBody = block[1];
  if (LEAF_MARKER.test(blockBody)) return null;
  const link = blockBody.match(FIRST_MD_LINK);
  if (!link?.[1] || !link[2]) return null;
  return { title: link[1].trim(), relPath: link[2].trim() };
}

/**
 * Read a Memory file's title — frontmatter `title:` for v0.5 files, an H1
 * scan for anything without frontmatter.
 */
export function readTitle(text: string): string | null {
  const parsed = parseMemoryFile(text);
  if (parsed.frontmatter) return parsed.frontmatter.title;
  const h1 = text.match(/^#\s+(.+?)\s*$/m);
  return h1?.[1]?.trim() ?? null;
}

/**
 * Convenience: re-export the parsed frontmatter alongside chain primitives so
 * callers can reach further into structured data without re-reading the file.
 */
export function parseStatusFrontmatter(text: string): MemoryFrontmatter | null {
  const fm = parseMemoryFile(text).frontmatter;
  return fm && fm.type === 'status' ? fm : null;
}

export function isStatusHeadless(text: string): boolean {
  return HEADLESS_MARKER.test(text);
}

export function asNodeRef(absPath: string, title: string): NodeRef {
  return { title, path: absPath };
}
