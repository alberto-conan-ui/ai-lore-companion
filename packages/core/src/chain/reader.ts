import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { locateLore } from './lore.js';
import { parseActiveChild, parseActiveFocus, parseMode } from './parse.js';
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
  const focus: NodeRef = { title: focusRef.title, path: focusAbs };

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
    current = { title: next.title, path: resolveLink(current.path, next.relPath) };
  }
  return current;
}

function resolveLink(fromFile: string, relPath: string): string {
  if (isAbsolute(relPath)) return relPath;
  return resolve(dirname(fromFile), relPath);
}
