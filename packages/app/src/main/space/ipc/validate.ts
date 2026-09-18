/**
 * Validation of what the renderer sends on a 1.0 channel.
 *
 * The renderer hosts embedded browser tabs, so a message from it is not
 * trusted input. Every 1.0 handler passes its argument through `parseArg`
 * with a zod schema before it uses it, and returns the failure as its result;
 * it does not throw. A handler that takes a path also resolves it against its
 * base with core's `safeJoin`; `relativePathSchema` only refuses the forms
 * that can never be inside a base.
 */

import { z } from 'zod';

/** A validated argument, or why it was refused. The failure is plain data and can cross IPC. */
export type ParsedArg<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: 'invalid-argument'; message: string } };

/** Validate `arg` against `schema`. The message names the fields, never their values. */
export function parseArg<T>(schema: z.ZodType<T>, arg: unknown): ParsedArg<T> {
  const parsed = schema.safeParse(arg);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fields = parsed.error.issues
    .map((issue) => (issue.path.length === 0 ? 'the argument' : issue.path.join('.')))
    .filter((field, index, all) => all.indexOf(field) === index);
  return {
    ok: false,
    error: {
      kind: 'invalid-argument',
      message: `The request was not accepted: ${fields.join(', ')} ${
        fields.length === 1 ? 'is' : 'are'
      } not of the expected form.`,
    },
  };
}

/** An absolute path, as text. Whether main may use it is for the handler to decide. */
export const absolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.includes('\0'), 'a path has no NUL character')
  .refine((path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path), 'an absolute path');

/**
 * A path relative to a base, with `/`: not absolute, no `..` segment, no NUL
 * character. The handler still joins it to its base with `safeJoin`, which
 * checks containment after symbolic links are resolved.
 */
export const relativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.includes('\0'), 'a path has no NUL character')
  .refine((path) => !path.startsWith('/') && !/^[A-Za-z]:/.test(path), 'a relative path')
  .refine((path) => !path.split(/[\\/]/).includes('..'), 'a path with no .. segment');

/** The id of a root, which is a payload's name or a fixed word: letters, digits, `.`, `_`, `-`. */
export const rootIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .max(200);
