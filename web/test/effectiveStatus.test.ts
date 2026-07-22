import { describe, expect, it } from 'vitest';
import { effectiveConnectorStatus } from '../src/lib/effectiveStatus';
import { loadSampleIndex } from './fixtures/loadFixture';
import type { Connector } from '../src/lib/schema';

const publisher = {
  expectedOIDCIssuer: 'https://token.actions.githubusercontent.com',
  expectedIdentityPattern:
    '^https://github\\.com/x/y/\\.github/workflows/publish\\.yml@refs/tags/v.*$',
};

function version(overrides: Partial<Connector['versions'][number]> = {}) {
  return {
    version: '1.0.0',
    minConduitVersion: '0.14.0',
    minProtocolVersion: '0.14.0',
    artifacts: [
      {
        os: 'linux' as const,
        arch: 'amd64' as const,
        kind: 'standalone' as const,
        url: 'https://example.test/a.tar.gz',
        sha256: 'a'.repeat(64),
        size: 1,
        signature: { bundleURL: 'https://example.test/a.sig' },
        slsaProvenance: {
          bundleURL: 'https://example.test/a.prov',
          predicateType: 'https://slsa.dev/provenance/v1',
        },
      },
    ],
    ...overrides,
  };
}

describe('effectiveConnectorStatus', () => {
  it('active: no yanked/deprecated/revoked at all', () => {
    const c: Connector = { name: 'x', publisher, versions: [version()] };
    expect(effectiveConnectorStatus(c)).toBe('active');
  });

  it('deprecated: default (newest non-yanked) version is deprecated', () => {
    const c: Connector = { name: 'x', publisher, versions: [version({ deprecated: true })] };
    expect(effectiveConnectorStatus(c)).toBe('deprecated');
  });

  it('revoked: publisher.revoked set, overrides everything else', () => {
    const c: Connector = {
      name: 'x',
      publisher: { ...publisher, revoked: { reason: 'compromised' } },
      versions: [version({ deprecated: true })],
    };
    expect(effectiveConnectorStatus(c)).toBe('revoked');
  });

  it('yanked: every published version carries yanked', () => {
    const c: Connector = {
      name: 'x',
      publisher,
      versions: [
        version({ version: '1.0.0', yanked: { reason: 'bad' } }),
        version({ version: '0.9.0', yanked: { reason: 'also bad' } }),
      ],
    };
    expect(effectiveConnectorStatus(c)).toBe('yanked');
  });

  it('SOME (not all) versions yanked -> connector stays active at the top level', () => {
    const c: Connector = {
      name: 'x',
      publisher,
      versions: [
        version({ version: '1.0.0' }),
        version({ version: '0.9.0', yanked: { reason: 'bad' } }),
      ],
    };
    expect(effectiveConnectorStatus(c)).toBe('active');
  });

  it('matches "yanked" for the sample index postgres connector? no — postgres has one yanked, one not', () => {
    const { payload } = loadSampleIndex();
    const postgres = payload.connectors.find((c) => c.name === 'postgres')!;
    expect(effectiveConnectorStatus(postgres)).toBe('active');
  });

  it('matches "revoked" for the sample index example-vector-sink connector', () => {
    const { payload } = loadSampleIndex();
    const revoked = payload.connectors.find((c) => c.name === 'example-vector-sink')!;
    expect(effectiveConnectorStatus(revoked)).toBe('revoked');
  });
});
