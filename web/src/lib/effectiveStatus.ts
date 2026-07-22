import type { Connector } from './schema';
import { isPublisherRevoked } from './deriveVerified';
import { pickDefaultVersion } from './pickDefaultVersion';

export type EffectiveStatus = 'active' | 'deprecated' | 'yanked' | 'revoked';

/**
 * Classifies a connector's top-level status for the list row / detail-page header
 * tag (step6-web-ui.md §5 item 1, §10). Precedence, most severe first:
 *
 *   1. `revoked`    — `publisher.revoked` is set. Overrides everything else.
 *   2. `yanked`     — every published version carries `yanked`. A connector with
 *                     SOME (not all) versions yanked stays "active" at this level;
 *                     only the affected version rows in the detail-page table are
 *                     flagged (step6-web-ui.md §10's explicit test case).
 *   3. `deprecated` — not revoked, not all-yanked, and the version this site would
 *                     show by default (pickDefaultVersion — newest non-yanked)
 *                     carries `deprecated: true`. NOTE: the frozen schema only
 *                     defines `deprecated` per-version, not per-connector; this
 *                     function's choice to project the *default-shown* version's
 *                     deprecated flag up to the connector level is this site's own
 *                     interpretation (not spelled out in the schema/plan), made
 *                     explicit here rather than silently assumed.
 *   4. `active`     — none of the above.
 */
export function effectiveConnectorStatus(connector: Connector): EffectiveStatus {
  if (isPublisherRevoked(connector)) return 'revoked';

  if (connector.versions.length > 0 && connector.versions.every((v) => Boolean(v.yanked))) {
    return 'yanked';
  }

  const defaultVersion = pickDefaultVersion(connector);
  if (defaultVersion?.deprecated) return 'deprecated';

  return 'active';
}
