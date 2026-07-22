import type { Connector, ConnectorVersion } from '../../src/lib/schema';

/**
 * The cross-implementation drift-guard fixture set (step6-web-ui.md §4/§10,
 * registry-plan-v2.md §11): connector/version -> expected `verified` boolean,
 * covering signed/unsigned/yanked/revoked cases. Intended to be asserted
 * against both this repo's `deriveVerified()` and the Go verification suite in
 * the index repo's PR-2 (once it exists) — a change to either definition that
 * isn't mirrored in the other should fail CI on both sides. This file is the
 * TypeScript half of that shared fixture; a `.json`-serializable subset is
 * exported below so it can be diffed against a future Go-side copy without
 * requiring the Go side to import TypeScript types.
 */

const sig = { bundleURL: 'https://example.test/sig.sigstore.json' };
const prov = {
  bundleURL: 'https://example.test/prov.intoto.jsonl',
  predicateType: 'https://slsa.dev/provenance/v1',
};

/** `artifact.signature` is schema-REQUIRED (index-schema.json), so every
 * fixture below includes it — there is no schema-valid way to omit it. That's
 * exactly registry-plan-v2.md §7's "coherence 1.6" fix: "signed but missing a
 * signature reference" is unreachable for anything actually in a merged
 * index, so this fixture set has no case for it (deriveVerified.test.ts
 * covers the defensive, off-schema "malformed artifact" path separately, cast
 * around the type system, precisely because it can't be expressed here). */
function artifact(withProv: boolean) {
  return {
    os: 'linux' as const,
    arch: 'amd64' as const,
    kind: 'standalone' as const,
    url: 'https://example.test/artifact.tar.gz',
    sha256: 'a'.repeat(64),
    size: 1024,
    signature: sig,
    ...(withProv ? { slsaProvenance: prov } : {}),
  };
}

function baseConnector(overrides: Partial<Connector['publisher']> = {}): Connector['publisher'] {
  return {
    expectedOIDCIssuer: 'https://token.actions.githubusercontent.com',
    expectedIdentityPattern:
      '^https://github\\.com/example/example/\\.github/workflows/publish\\.yml@refs/tags/v.*$',
    ...overrides,
  };
}

export interface VerifiedFixtureCase {
  name: string;
  connector: Connector;
  version: ConnectorVersion;
  expectedVerified: boolean;
}

export const VERIFIED_FIXTURE_CASES: VerifiedFixtureCase[] = [
  {
    name: 'signed + provenance + active -> verified',
    connector: { name: 'signed-active', publisher: baseConnector(), versions: [] },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(true)],
    },
    expectedVerified: true,
  },
  {
    name: 'missing provenance -> not verified',
    connector: { name: 'no-provenance', publisher: baseConnector(), versions: [] },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(false)],
    },
    expectedVerified: false,
  },
  {
    name: 'yanked (even if signed+provenance) -> not verified',
    connector: { name: 'yanked-connector', publisher: baseConnector(), versions: [] },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(true)],
      yanked: { reason: 'bad build' },
    },
    expectedVerified: false,
  },
  {
    name: 'publisher.revoked -> not verified even for an individually well-signed version',
    connector: {
      name: 'revoked-connector',
      publisher: baseConnector({ revoked: { reason: 'compromised identity' } }),
      versions: [],
    },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(true)],
    },
    expectedVerified: false,
  },
  {
    name: 'deprecated but signed -> still verified (deprecated is orthogonal)',
    connector: { name: 'deprecated-connector', publisher: baseConnector(), versions: [] },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(true)],
      deprecated: true,
    },
    expectedVerified: true,
  },
  {
    name: 'version-level slsaProvenance (not per-artifact) -> verified',
    connector: { name: 'version-level-provenance', publisher: baseConnector(), versions: [] },
    version: {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [artifact(false)],
      slsaProvenance: prov,
    },
    expectedVerified: true,
  },
];
