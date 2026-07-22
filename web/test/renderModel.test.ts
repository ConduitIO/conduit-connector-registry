import { describe, expect, it } from 'vitest';
import { buildRenderModel } from '../src/lib/renderModel';
import { BuildError } from '../src/lib/errors';
import { loadSampleIndex } from './fixtures/loadFixture';
import type { IndexPayload } from '../src/lib/schema';

describe('buildRenderModel — reserved-route-segment collision (§9 edge case)', () => {
  it('fails the whole build loudly if a connector name collides with a reserved route segment', () => {
    const { payload } = loadSampleIndex();
    payload.connectors[0]!.name = '404';
    try {
      buildRenderModel(payload);
      expect.fail('expected buildRenderModel to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BuildError);
      expect((err as BuildError).code).toBe('ERR_RESERVED_ROUTE_COLLISION');
    }
  });

  it('fails on a duplicate connector name (index-CI is supposed to prevent this, but the site refuses too)', () => {
    const { payload } = loadSampleIndex();
    const dup = structuredClone(payload.connectors[0]!);
    payload.connectors.push(dup);
    expect(() => buildRenderModel(payload)).toThrow(BuildError);
  });
});

describe('buildRenderModel — install-command suppression', () => {
  it('suppresses install for a revoked-publisher connector', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const revoked = model.connectors.find((c) => c.name === 'example-vector-sink')!;
    expect(revoked.suppressInstallCommand).toBe(true);
    expect(revoked.effectiveStatus).toBe('revoked');
  });

  it('does not suppress install for an active connector with a partially-yanked version history', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const postgres = model.connectors.find((c) => c.name === 'postgres')!;
    expect(postgres.suppressInstallCommand).toBe(false);
  });

  it('suppresses install when every version of a connector is yanked', () => {
    const payload: IndexPayload = {
      schemaVersion: 1,
      index: { version: 1, timestamp: '2026-07-14T09:00:00Z' },
      connectors: [
        {
          name: 'all-yanked-connector',
          publisher: {
            expectedOIDCIssuer: 'https://token.actions.githubusercontent.com',
            expectedIdentityPattern:
              '^https://github\\.com/x/y/\\.github/workflows/publish\\.yml@refs/tags/v.*$',
          },
          versions: [
            {
              version: '1.0.0',
              minConduitVersion: '0.14.0',
              minProtocolVersion: '0.14.0',
              artifacts: [],
              yanked: { reason: 'bad build' },
            },
          ],
        },
      ],
    };
    const model = buildRenderModel(payload);
    const c = model.connectors[0]!;
    expect(c.effectiveStatus).toBe('yanked');
    expect(c.allVersionsYanked).toBe(true);
    expect(c.suppressInstallCommand).toBe(true);
  });
});

describe('buildRenderModel — compatibility matrix always renders both explicit states', () => {
  it('every OS x arch cell is present (available or not), never blank/omitted', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const postgres = model.connectors.find((c) => c.name === 'postgres')!;
    const v0141 = postgres.versions.find((v) => v.version === '0.14.1')!;
    // schema enum: os in {linux,darwin,windows}, arch in {amd64,arm64} = 6 cells
    expect(v0141.compat).toHaveLength(6);
    // The sample index only ships linux/amd64 + darwin/arm64 for 0.14.1 — every
    // other combination (including windows entirely) must render explicitly
    // "not available", never be missing from the array.
    const windowsCells = v0141.compat.filter((c) => c.os === 'windows');
    expect(windowsCells).toHaveLength(2);
    expect(windowsCells.every((c) => c.available === false)).toBe(true);
    const linuxAmd64 = v0141.compat.find((c) => c.os === 'linux' && c.arch === 'amd64')!;
    expect(linuxAmd64.available).toBe(true);
  });
});

describe('buildRenderModel — search manifest carries only presentation fields', () => {
  it('never includes trust-relevant fields (signature/provenance/publisher)', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const allowedKeys = new Set([
      'description',
      'displayName',
      'effectiveStatus',
      'name',
      'repository',
    ]);
    for (const entry of model.searchManifest) {
      for (const key of Object.keys(entry)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    }
  });
});
