import { describe, expect, it } from 'vitest';
import {
  deriveVerified,
  hasSignaturePresent,
  hasProvenancePresent,
} from '../src/lib/deriveVerified';
import { VERIFIED_FIXTURE_CASES } from './fixtures/verifiedFixtures';
import { loadSampleIndex } from './fixtures/loadFixture';
import type { ConnectorVersion } from '../src/lib/schema';

describe('deriveVerified — the shared fixture set (step6-web-ui.md §4/§10)', () => {
  for (const c of VERIFIED_FIXTURE_CASES) {
    it(c.name, () => {
      expect(deriveVerified(c.version, c.connector)).toBe(c.expectedVerified);
    });
  }
});

describe('deriveVerified — defensive behavior against malformed (off-schema) data', () => {
  it('treats a version with an artifact missing its signature as unverified, not as a crash', () => {
    const malformed = {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [
        {
          os: 'linux',
          arch: 'amd64',
          kind: 'standalone',
          url: 'x',
          sha256: 'a'.repeat(64),
          size: 1,
        },
      ],
    } as unknown as ConnectorVersion;
    expect(hasSignaturePresent(malformed)).toBe(false);
  });

  it('treats a version with zero artifacts as unsigned/unverified, not as vacuously true', () => {
    const noArtifacts = {
      version: '1.0.0',
      minConduitVersion: '0.14.0',
      minProtocolVersion: '0.14.0',
      artifacts: [],
    } as unknown as ConnectorVersion;
    expect(hasSignaturePresent(noArtifacts)).toBe(false);
    expect(hasProvenancePresent(noArtifacts)).toBe(false);
  });
});

describe('deriveVerified — against the real frozen sample index', () => {
  it('postgres 0.14.1 (signed, provenance, not yanked, publisher not revoked) is verified', () => {
    const { payload } = loadSampleIndex();
    const postgres = payload.connectors.find((c) => c.name === 'postgres')!;
    const v0141 = postgres.versions.find((v) => v.version === '0.14.1')!;
    expect(deriveVerified(v0141, postgres)).toBe(true);
  });

  it('postgres 0.14.0 (yanked, even though signed+provenance) is NOT verified', () => {
    const { payload } = loadSampleIndex();
    const postgres = payload.connectors.find((c) => c.name === 'postgres')!;
    const v0140 = postgres.versions.find((v) => v.version === '0.14.0')!;
    expect(v0140.yanked).toBeDefined();
    expect(deriveVerified(v0140, postgres)).toBe(false);
  });

  it('example-vector-sink 0.3.0 (individually signed, but publisher revoked) is NOT verified', () => {
    const { payload } = loadSampleIndex();
    const revokedConnector = payload.connectors.find((c) => c.name === 'example-vector-sink')!;
    expect(revokedConnector.publisher.revoked).toBeDefined();
    const v030 = revokedConnector.versions.find((v) => v.version === '0.3.0')!;
    // This version has its own valid signature+provenance references — verifies
    // the "revoked overrides even an individually well-signed version" rule
    // against real fixture data, not just a synthetic one.
    expect(hasSignaturePresent(v030)).toBe(true);
    expect(hasProvenancePresent(v030)).toBe(true);
    expect(deriveVerified(v030, revokedConnector)).toBe(false);
  });
});
