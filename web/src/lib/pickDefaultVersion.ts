import type { Connector, ConnectorVersion } from './schema';
import { isYanked } from './deriveVerified';
import { sortVersionsDescending } from './semver';

/**
 * Picks the version shown by default: the compat-matrix default and the
 * install-command's implicit target (no `@version` pin — mirrors the CLI's own
 * "newest compatible" resolution philosophy, step6-web-ui.md §5 item 3).
 *
 * The newest NON-yanked version, by convention the index already lists
 * newest-first but this re-sorts defensively (schema doesn't enforce order).
 *
 * If every version is yanked, this still returns the newest version anyway —
 * transparently, with its yank reason surfaced by the caller — rather than
 * returning undefined, per step6-web-ui.md §10's explicit test case ("falls back
 * to showing the newest anyway ... rather than picking nothing").
 */
export function pickDefaultVersion(connector: Connector): ConnectorVersion | undefined {
  if (connector.versions.length === 0) return undefined;

  const nonYanked = connector.versions.filter((v) => !isYanked(v));
  const pool = nonYanked.length > 0 ? nonYanked : connector.versions;

  const sorted = sortVersionsDescending(pool, (v) => v.version);
  return sorted[0];
}
