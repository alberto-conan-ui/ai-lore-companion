import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { parseMemoryFile } from '../frontmatter/parser.js';
import { locateLore } from './lore.js';
import { parseActiveChild, parseActiveFocus, parseMode, readTitle } from './parse.js';
import type { ChainResult, NodeRef } from './types.js';

const MAX_DEPTH = 16;

export function readChain({ root }: { root: string }): ChainResult {
  const located = locateLore(root);
  if ('error' in located) return { error: located.error };

  const statusPath = resolve(located.lorePath, 'memory/status/status.index.md');
  let statusText: string;
  try {
    statusText = readFileSync(statusPath, 'utf8');
  } catch (err) {
    return { error: `cannot read status: ${(err as Error).message}` };
  }

  const mode = parseMode(statusText) ?? 'unknown';
  const focusRef = parseActiveFocus(statusText);
  if (!focusRef) {
    return {
      mode,
      focus: null,
      activeChild: null,
      root,
      lorePath: located.lorePath,
    };
  }

  const focusAbs = resolveLink(statusPath, focusRef.relPath);
  // Title priority: linked file's frontmatter `title:` (v0.5) > the link
  // text the parent already carried (v0.4 — the markdown link the Human
  // Lead wrote) > the file's H1 (last resort) > basename.
  const focusTitle =
    readLinkedFrontmatterTitle(focusAbs) ??
    nonEmpty(focusRef.title) ??
    readLinkedTitle(focusAbs) ??
    basename(focusAbs);
  const focus: NodeRef = { title: focusTitle, path: focusAbs };

  const activeChild = walkActiveChild(focus);
  return {
    mode,
    focus,
    activeChild,
    root,
    lorePath: located.lorePath,
  };
}

function walkActiveChild(start: NodeRef): NodeRef {
  let current: NodeRef = start;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    let text: string;
    try {
      text = readFileSync(current.path, 'utf8');
    } catch {
      return current;
    }
    const next = parseActiveChild(text);
    if (!next) return current;
    const childPath = resolveLink(current.path, next.relPath);
    // Same priority as the active focus: frontmatter `title:` > parent's
    // own link text > linked H1 > basename. The link text is the Human
    // Lead's authored short label and beats a sprawling H1 chapeau.
    const childTitle =
      readLinkedFrontmatterTitle(childPath) ??
      nonEmpty(next.title) ??
      readLinkedTitle(childPath) ??
      basename(childPath);
    current = { title: childTitle, path: childPath };
  }
  return current;
}

function readLinkedTitle(absPath: string): string | null {
  try {
    const text = readFileSync(absPath, 'utf8');
    return readTitle(text);
  } catch {
    return null;
  }
}

function readLinkedFrontmatterTitle(absPath: string): string | null {
  try {
    const text = readFileSync(absPath, 'utf8');
    return parseMemoryFile(text).frontmatter?.title ?? null;
  } catch {
    return null;
  }
}

function nonEmpty(value: string | undefined | null): string | null {
  return value && value.length > 0 ? value : null;
}

function resolveLink(fromFile: string, relPath: string): string {
  if (isAbsolute(relPath)) return relPath;
  return resolve(dirname(fromFile), relPath);
}
