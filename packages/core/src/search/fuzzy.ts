/**
 * Fuzzy subsequence scoring for file-name search — the ranking core of Focus 3
 * (Search That Earns Its Name). Replaces the old substring `includes`: a query
 * matches when its characters appear in order anywhere in the target, and the
 * score rewards the matches that *feel* most relevant — matches at word/path
 * boundaries, contiguous runs, and matches that start at the beginning.
 *
 * Case-insensitive. Returns `null` when the query is not a subsequence of the
 * target (no match), or a number where higher is better. Pure and allocation-
 * light so it can run over thousands of names per keystroke.
 *
 * The matcher is greedy left-to-right: each query character takes the next
 * occurrence in the target. This is fast and good for file names; it can score
 * a later, more-contiguous alignment lower than a DP matcher (fzf) would. That
 * trade is deliberate for Phase 1 — correctness of *ordering on the common
 * cases* (exact prefix > boundary subsequence > scattered; shorter wins ties)
 * matters more than optimal alignment on adversarial inputs.
 */

/** Bonus for a match at the very first character of the target. */
const BONUS_FIRST = 6;
/** Bonus for a match immediately after a delimiter (a word/path boundary). */
const BONUS_BOUNDARY = 10;
/** Bonus for a match at a camelCase hump (lower→Upper in the original case). */
const BONUS_CAMEL = 8;
/** Bonus for a match immediately following the previous match (a run). */
const BONUS_CONSECUTIVE = 8;
/** Score for matching a character at all. */
const SCORE_MATCH = 1;
/** Penalty per skipped character in a gap, capped so long names don't underflow. */
const PENALTY_GAP = 1;
const GAP_CAP = 6;
/** Per-character length tiebreak — shorter targets edge out longer on a tie. */
const LENGTH_TIEBREAK = 0.01;

const DELIMITERS = new Set(['/', '\\', '_', '-', '.', ' ']);

function isUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}
function isLower(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

/**
 * Score `query` against `target`. Returns `null` if `query` is not a
 * (case-insensitive) subsequence of `target`; otherwise a relevance score where
 * higher is more relevant. An empty query scores 0 (matches everything).
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  if (query.length > target.length) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let qi = 0;
  let prevMatch = -1;

  for (let ti = 0; ti < target.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    score += SCORE_MATCH;

    if (ti === 0) {
      score += BONUS_FIRST + BONUS_BOUNDARY;
    } else {
      const prev = target[ti - 1] as string;
      if (DELIMITERS.has(prev)) score += BONUS_BOUNDARY;
      else if (isLower(prev) && isUpper(target[ti] as string)) score += BONUS_CAMEL;
    }

    if (prevMatch >= 0 && ti === prevMatch + 1) {
      score += BONUS_CONSECUTIVE;
    } else if (prevMatch >= 0) {
      score -= Math.min(PENALTY_GAP * (ti - prevMatch - 1), GAP_CAP);
    } else if (ti > 0) {
      // Leading gap before the first matched character.
      score -= Math.min(PENALTY_GAP * ti, GAP_CAP);
    }

    prevMatch = ti;
    qi++;
  }

  if (qi < q.length) return null;

  // Shorter targets win ties — a query matching a short name is more relevant
  // than the same query buried in a long one.
  return score - target.length * LENGTH_TIEBREAK;
}
