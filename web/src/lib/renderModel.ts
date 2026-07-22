import type {
  ArtifactArch,
  ArtifactOS,
  Connector,
  IndexPayload,
  Revocation,
  YankReason,
} from './schema';
import { ALL_ARCH, ALL_OS } from './schema';
import { deriveVerified } from './deriveVerified';
import { effectiveConnectorStatus, type EffectiveStatus } from './effectiveStatus';
import { pickDefaultVersion } from './pickDefaultVersion';
import { isReservedRouteSegment } from './reserved';
import { BuildError } from './errors';

export interface CompatCellModel {
  os: ArtifactOS;
  arch: ArtifactArch;
  available: boolean;
}

export interface RenderedVersion {
  version: string;
  releasedAt?: string;
  minConduitVersion: string;
  minProtocolVersion: string;
  deprecated: boolean;
  yanked?: YankReason;
  verified: boolean;
  isDefault: boolean;
  compat: CompatCellModel[];
}

/** Best-effort download-stats shape, merged in after the (independently
 * fault-tolerant) Scarf fetch step — see fetchScarfStats.mjs. Absent entirely
 * until that step runs; `unavailable: true` when Scarf couldn't be reached for
 * this connector specifically (never a bare 0 — see step6-web-ui.md §5 item 6). */
export interface ConnectorStats {
  unavailable: boolean;
  totalDownloads?: number;
  asOf: string;
}

export interface RenderedConnector {
  name: string;
  displayName: string;
  description: string;
  repository?: string;
  effectiveStatus: EffectiveStatus;
  revoked?: Revocation;
  allVersionsYanked: boolean;
  /** Suppresses the install-command copy-block whenever true — revoked publisher
   * OR every version yanked (step6-web-ui.md §5 item 2/3). */
  suppressInstallCommand: boolean;
  defaultVersion?: string;
  versions: RenderedVersion[];
  stats?: ConnectorStats;
}

export interface SearchManifestEntry {
  name: string;
  displayName: string;
  description: string;
  repository?: string;
  effectiveStatus: EffectiveStatus;
}

export interface RenderModel {
  generatedAt: string;
  indexVersion: number;
  indexTimestamp: string;
  verified: boolean;
  connectors: RenderedConnector[];
  searchManifest: SearchManifestEntry[];
}

function buildCompatMatrix(
  connector: Connector,
  version: RenderedVersion['version']
): CompatCellModel[] {
  const found = connector.versions.find((v) => v.version === version);
  const artifacts = found?.artifacts ?? [];
  const cells: CompatCellModel[] = [];
  for (const os of ALL_OS) {
    for (const arch of ALL_ARCH) {
      cells.push({
        os,
        arch,
        available: artifacts.some((a) => a.os === os && a.arch === arch),
      });
    }
  }
  return cells;
}

/**
 * Transforms the verified payload into exactly what the Astro pages consume,
 * computing every derived field once, in one place (step6-web-ui.md §3 step 5).
 * Also enforces the reserved-route-segment check (§9 edge case) — a connector
 * name colliding with a route this generator itself uses fails the WHOLE build
 * loudly, rather than silently shadowing a route for one connector.
 */
export function buildRenderModel(
  payload: IndexPayload,
  opts: { verified?: boolean; generatedAt?: string } = {}
): RenderModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const seenNames = new Set<string>();
  const connectors: RenderedConnector[] = payload.connectors.map((connector) => {
    if (isReservedRouteSegment(connector.name)) {
      throw new BuildError(
        'ERR_RESERVED_ROUTE_COLLISION',
        `connector name "${connector.name}" collides with a reserved site route segment — ` +
          `refusing to generate (this would silently shadow a real page)`
      );
    }
    if (seenNames.has(connector.name)) {
      throw new BuildError(
        'ERR_RESERVED_ROUTE_COLLISION',
        `duplicate connector name "${connector.name}" in index — index-CI is supposed to enforce ` +
          `uniqueness; refusing to generate two pages at the same URL`
      );
    }
    seenNames.add(connector.name);

    const effectiveStatus = effectiveConnectorStatus(connector);
    const allVersionsYanked = effectiveStatus === 'yanked';
    const suppressInstallCommand = effectiveStatus === 'revoked' || allVersionsYanked;
    const defaultVersion = pickDefaultVersion(connector);

    const versions: RenderedVersion[] = connector.versions.map((v) => ({
      version: v.version,
      ...(v.releasedAt !== undefined ? { releasedAt: v.releasedAt } : {}),
      minConduitVersion: v.minConduitVersion,
      minProtocolVersion: v.minProtocolVersion,
      deprecated: Boolean(v.deprecated),
      ...(v.yanked !== undefined ? { yanked: v.yanked } : {}),
      verified: deriveVerified(v, connector),
      isDefault: defaultVersion?.version === v.version,
      compat: buildCompatMatrix(connector, v.version),
    }));

    return {
      name: connector.name,
      displayName: connector.displayName ?? connector.name,
      description: connector.description ?? '',
      ...(connector.repository !== undefined ? { repository: connector.repository } : {}),
      effectiveStatus,
      ...(connector.publisher.revoked !== undefined
        ? { revoked: connector.publisher.revoked }
        : {}),
      allVersionsYanked,
      suppressInstallCommand,
      ...(defaultVersion !== undefined ? { defaultVersion: defaultVersion.version } : {}),
      versions,
    };
  });

  const searchManifest: SearchManifestEntry[] = connectors.map((c) => ({
    name: c.name,
    displayName: c.displayName,
    description: c.description,
    ...(c.repository !== undefined ? { repository: c.repository } : {}),
    effectiveStatus: c.effectiveStatus,
  }));

  return {
    generatedAt,
    indexVersion: payload.index.version,
    indexTimestamp: payload.index.timestamp,
    verified: opts.verified ?? false,
    connectors,
    searchManifest,
  };
}
