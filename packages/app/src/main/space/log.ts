/**
 * The log of the 1.0 code in main. One JSON object per line, appended to
 * `<userData>/logs/space-<date>.log`, and the same line to `console`, which is
 * where the rest of main logs today.
 *
 * What is never in a log: a token, a secret, a password, a request header, and
 * the content of a file or the output of a command. `sanitizeLogFields`
 * enforces it by the name of the field, so a caller that passes such a field
 * by mistake still writes none of it. A session token is shown as its first
 * four characters.
 *
 * Logging never throws and never stops the caller: a line that cannot be
 * written to the file is still sent to `console`.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** The level of a log line. */
export type SpaceLogLevel = 'info' | 'warn' | 'error';

/** A value a log field may hold. Anything else is written as its string form. */
export type SpaceLogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly SpaceLogValue[]
  | { readonly [key: string]: SpaceLogValue };

/** The fields of a log line, beside its time, level and event. */
export type SpaceLogFields = { readonly [key: string]: SpaceLogValue };

/** The logger every 1.0 module in main receives. `event` is a short name in kebab-case. */
export type SpaceLog = {
  info(event: string, fields?: SpaceLogFields): void;
  warn(event: string, fields?: SpaceLogFields): void;
  error(event: string, fields?: SpaceLogFields): void;
};

/** What `createSpaceLog` needs. Tests pass their own clock and a silent console. */
export type SpaceLogOptions = {
  /** `<userData>/logs`. A function, because `userData` is known only once the app is ready. */
  logsDir: () => string;
  now?: () => Date;
  console?: Pick<Console, 'log' | 'warn' | 'error'>;
};

/** A field whose name matches is a credential: only its first four characters are written. */
const CREDENTIAL_FIELD =
  /token|secret|password|passphrase|credential|authorization|cookie|api[-_]?key/i;
/** A field whose name matches holds content or output: it is not written. */
const CONTENT_FIELD = /^(content|contents|text|body|data|stdout|stderr|output|input|diff|patch)$/i;
/** A longer string is cut, so that content passed under another name does not fill the log. */
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 4;

function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (CONTENT_FIELD.test(key)) return '[not logged]';
  if (CREDENTIAL_FIELD.test(key)) {
    return typeof value === 'string' && value.length > 0 ? `${value.slice(0, 4)}…` : '[not logged]';
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue('', item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      out[childKey] = sanitizeValue(childKey, child, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** The fields as they are written: credentials cut to four characters, content left out, long strings cut. */
export function sanitizeLogFields(fields: SpaceLogFields): Record<string, unknown> {
  return sanitizeValue('', fields, 0) as Record<string, unknown>;
}

/** The name of the log file for a day: `space-2026-09-18.log`, by the date in UTC. */
export function spaceLogFileName(date: Date): string {
  return `space-${date.toISOString().slice(0, 10)}.log`;
}

/** Build the logger. Nothing is created on disk until the first line is written. */
export function createSpaceLog(options: SpaceLogOptions): SpaceLog {
  const now = options.now ?? ((): Date => new Date());
  const sink = options.console ?? console;

  const write = (level: SpaceLogLevel, event: string, fields: SpaceLogFields = {}): void => {
    const at = now();
    let line: string;
    try {
      line = JSON.stringify({
        ...sanitizeLogFields(fields),
        time: at.toISOString(),
        level,
        event,
      });
    } catch {
      line = JSON.stringify({ time: at.toISOString(), level, event, note: 'fields not written' });
    }
    try {
      const dir = options.logsDir();
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, spaceLogFileName(at)), `${line}\n`, 'utf8');
    } catch {
      // The console line below is the record when the file cannot be written.
    }
    if (level === 'error') sink.error(`[space] ${line}`);
    else if (level === 'warn') sink.warn(`[space] ${line}`);
    else sink.log(`[space] ${line}`);
  };

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

/** A logger that writes nothing, for tests that do not look at the log. */
export const silentSpaceLog: SpaceLog = { info: () => {}, warn: () => {}, error: () => {} };
