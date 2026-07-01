/**
 * Fuzzy subsequence scoring for file-name search — the ranking core of Focus 3
 * (Search That Earns Its Name). A query matches when its characters appear in
 * order anywhere in the target, and the score rewards the matches that *feel*
 * most relevant — matches at word/path boundaries, contiguous runs, and
 * matches that start at the beginning.
 *
 * Scoring is delegated to `fuzzysort` (a maintained, DP-alignment matcher —
 * it finds the best alignment where the old hand-rolled greedy scorer took
 * the first). The contract is unchanged: case-insensitive; `null` when the
 * query is not a subsequence of the target (no match); otherwise a number
 * where higher is better; an empty query scores 0 (matches everything).
 * `fuzzysort` folds target length into its score, so shorter targets still
 * edge out longer ones on equal-structure ties.
 */

import fuzzysort from 'fuzzysort';

/**
 * Score `query` against `target`. Returns `null` if `query` is not a
 * (case-insensitive) subsequence of `target`; otherwise a relevance score where
 * higher is more relevant. An empty query scores 0 (matches everything).
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  const result = fuzzysort.single(query, target);
  return result === null ? null : result.score;
}
