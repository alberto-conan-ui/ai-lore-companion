import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { parseMemoryFile } from '../frontmatter/parser.js';
import type { Dials, FocusStatus, FocusType, Posture } from '../frontmatter/types.js';
import { latestSavePoint } from '../save-points/save-points.js';
import { readProjectShape } from '../workspace/shape.js';
import { locateLore } from './lore.js';
import {
  parseActiveChild,
  parseActiveFocus,
  parseMode,
  parseRegister,
  readTitle,
} from './parse.js';
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
  const register = parseRegister(statusText);
  const posture: Posture | null = isPosture(register.posture) ? register.posture : null;
  const dials: Dials | null =
    isAltitude(register.altitude) && isCommitment(register.commitment)
      ? { altitude: register.altitude, commitment: register.commitment }
      : null;

  const hasSavePoint = latestSavePoint(resolve(located.lorePath, 'memory/save-points')) !== null;

  // v0.8 Phase A — read the project's shape declaration. Tolerant of a
  // missing or malformed `publish:` block (returns `'default'` + console
  // warning); never blocks the chain on it.
  const shapeInfo = readProjectShape(located.lorePath);

  const focusRef = parseActiveFocus(statusText);
  if (!focusRef) {
    const base = {
      mode,
      posture,
      dials,
      focus: null,
      focusType: null,
      focusStatus: null,
      activeChild: null,
      root,
      lorePath: located.lorePath,
      hasSavePoint,
      coreVersion: shapeInfo.coreVersion,
      shape: shapeInfo.shape,
    } as const;
    return shapeInfo.publish ? { ...base, publish: shapeInfo.publish } : base;
  }

  const focusAbs = resolveLink(statusPath, focusRef.relPath);
  const focusMeta = readFocusMeta(focusAbs);
  // Title priority: linked file's frontmatter `title:` (v0.5) > the link
  // text the parent already carried (v0.4 — the markdown link the Human
  // Lead wrote) > the file's H1 (last resort) > basename.
  const focusTitle =
    focusMeta.title ?? nonEmpty(focusRef.title) ?? readLinkedTitle(focusAbs) ?? basename(focusAbs);
  const focus: NodeRef = { title: focusTitle, path: focusAbs };

  const activeChild = walkActiveChild(focus);
  const base = {
    mode,
    posture,
    dials,
    focus,
    focusType: focusMeta.focusType,
    focusStatus: focusMeta.focusStatus,
    activeChild,
    root,
    lorePath: located.lorePath,
    hasSavePoint,
    coreVersion: shapeInfo.coreVersion,
    shape: shapeInfo.shape,
  } as const;
  return shapeInfo.publish ? { ...base, publish: shapeInfo.publish } : base;
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

type FocusMeta = {
  title: string | null;
  focusType: FocusType | null;
  focusStatus: FocusStatus | null;
};

function readFocusMeta(absPath: string): FocusMeta {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return { title: null, focusType: null, focusStatus: null };
  }
  const fm = parseMemoryFile(text).frontmatter;
  if (fm && fm.type === 'focus') {
    return { title: fm.title, focusType: fm.focus_type, focusStatus: fm.status };
  }
  // Pre-v0.5 fallback: H1 title only — no focus_type / status without
  // frontmatter.
  return { title: readTitle(text), focusType: null, focusStatus: null };
}

function nonEmpty(value: string | undefined | null): string | null {
  return value && value.length > 0 ? value : null;
}

function resolveLink(fromFile: string, relPath: string): string {
  if (isAbsolute(relPath)) return relPath;
  return resolve(dirname(fromFile), relPath);
}

function isPosture(value: string | null): value is Posture {
  return value === 'chat' || value === 'plan' || value === 'reshape' || value === 'execute';
}

function isAltitude(value: string | null): value is 'low' | 'mid' | 'high' {
  return value === 'low' || value === 'mid' || value === 'high';
}

function isCommitment(value: string | null): value is 'go' | 'neutral' | 'challenge' {
  return value === 'go' || value === 'neutral' || value === 'challenge';
}
