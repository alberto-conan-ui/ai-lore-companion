/**
 * The values of the frontmatter subset.
 *
 * This file imports nothing, so the renderer can take every type here with
 * `import type` and pull no Node code. Everything is plain data.
 */

/** One scalar of the frontmatter subset: text, a whole number, `true` or `false`, or `null`. */
export type FrontmatterScalar = string | number | boolean | null;

/** A map of one level: every value is a scalar. */
export type FrontmatterMap = { [key: string]: FrontmatterScalar };

/** The five forms of a value of the frontmatter subset (the empty list is a `FrontmatterScalar[]`). */
export type FrontmatterValue =
  | FrontmatterScalar
  | FrontmatterScalar[]
  | FrontmatterMap
  | FrontmatterMap[];

/** The frontmatter of a file of the Lore, read in the subset. */
export type LoreFrontmatter = { [key: string]: FrontmatterValue };
