/**
 * Small Levenshtein distance implementation for the 404 page's "did you mean
 * postgres?" suggestions ONLY. This is a presentation convenience, not a
 * trust/authorization decision — `install`'s own name resolution stays
 * exact-match-only (index-schema.json: "Resolution by `install` is
 * exact-match only (no fuzzy/nearest-match)"). Do not repurpose this for
 * anything install-adjacent; if a future change makes the CLI fuzzy-match
 * too, that's a deliberate, separately-reviewed security decision, not an
 * accidental consequence of this file existing (step6-web-ui.md §5, `/404`
 * row).
 */
export function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

export function closestNames(
  query: string,
  candidates: readonly string[],
  maxDistance = 3,
  limit = 3
): string[] {
  return candidates
    .map((name) => ({
      name,
      distance: levenshteinDistance(query.toLowerCase(), name.toLowerCase()),
    }))
    .filter((c) => c.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((c) => c.name);
}
