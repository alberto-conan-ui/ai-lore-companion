/**
 * The result type of the 1.0 library (`core/src/space`).
 *
 * A function that can fail for a reason its caller must handle returns a
 * `Result`. It throws only for a programming error. IPC handlers return the
 * `Result` as it is, so both shapes are plain data.
 */

/**
 * Why an operation failed. `kind` is a short machine-readable word that a
 * caller can branch on (`'outside-base'`, `'command-failed'`); `message` is a
 * sentence that can be shown to the Human Lead. A module narrows `K` to its own
 * union of kinds when its callers need to branch on them.
 */
export type Failure<K extends string = string> = { kind: K; message: string };

/** The outcome of an operation: a value, or the reason there is none. */
export type Result<T, E = Failure> = { ok: true; value: T } | { ok: false; error: E };

/** A successful `Result` carrying `value`. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** A failed `Result` carrying `error` (any error shape). */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** A failed `Result` carrying a `Failure` built from `kind` and `message`. */
export function fail<K extends string>(kind: K, message: string): { ok: false; error: Failure<K> } {
  return { ok: false, error: { kind, message } };
}

/**
 * The text of a caught value. A `catch` clause receives `unknown`; this gives
 * the `message` of an `Error` and the string form of anything else.
 */
export function errorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

/**
 * The `code` of a Node system error (`'ENOENT'`, `'EACCES'`), or `null` when
 * the caught value does not carry one.
 */
export function errorCode(caught: unknown): string | null {
  if (typeof caught !== 'object' || caught === null) return null;
  const code = (caught as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
