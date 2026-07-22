import semver from 'semver';

/**
 * Version-string normalization, matching the same "semver equality, tolerating an
 * optional leading v" rule the CLI/engine use (registry-plan-v2.md §5) — the index
 * always stores bare semver, but this module never assumes a caller's input already
 * matches that shape.
 */
export function normalizeVersion(input: string): string {
  const stripped = input.startsWith('v') || input.startsWith('V') ? input.slice(1) : input;
  const parsed = semver.parse(stripped);
  return parsed ? parsed.version : stripped;
}

/** Sorts version strings newest-first. Falls back to string comparison for anything
 * that fails to parse as semver, rather than throwing — the index's `versions[]` is
 * documented as "newest-first by convention, not schema-enforced," so this is a
 * defensive re-sort, not a trust operation. */
export function sortVersionsDescending<T>(
  items: readonly T[],
  getVersion: (item: T) => string
): T[] {
  return [...items].sort((a, b) => {
    const av = semver.parse(normalizeVersion(getVersion(a)));
    const bv = semver.parse(normalizeVersion(getVersion(b)));
    if (av && bv) return semver.rcompare(av, bv);
    return getVersion(b).localeCompare(getVersion(a));
  });
}
