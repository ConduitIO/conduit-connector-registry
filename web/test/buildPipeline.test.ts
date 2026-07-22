import { describe, expect, it } from 'vitest';
import { verifyAndParseIndex } from '../src/lib/verifyIndex';
import { buildRenderModel } from '../src/lib/renderModel';
import { BuildError } from '../src/lib/errors';
import {
  loadSampleIndex,
  loadSampleIndexRaw,
  SAMPLE_INDEX_TIMESTAMP,
} from './fixtures/loadFixture';

/**
 * Integration tests for the actual index -> site-generation PIPELINE
 * (verifyAndParseIndex -> buildRenderModel), the same two calls
 * scripts/build-site.ts makes in order, against real fixture data — not
 * mocks of either function (step6-web-ui.md §10's "Build-pipeline
 * integration tests"). The full `npm run build` (which additionally spawns
 * `astro build` and writes dist/) is exercised end-to-end manually and in CI
 * (.github/workflows/ci.yml); shelling out to a real subprocess on every
 * unit-test run would make this suite slow and is unnecessary once the two
 * functions it calls are independently proven correct here.
 */
const NOW = new Date(SAMPLE_INDEX_TIMESTAMP);

describe('pipeline — valid fixture', () => {
  it('produces the expected connector/page count and specific expected strings', () => {
    const raw = loadSampleIndexRaw();
    const verified = verifyAndParseIndex(raw, { now: NOW });
    const model = buildRenderModel(verified.payload, { verified: verified.verified });

    expect(model.connectors).toHaveLength(2);
    const postgres = model.connectors.find((c) => c.name === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.displayName).toBe('PostgreSQL');
    expect(postgres!.description).toContain('PostgreSQL');
  });
});

describe('pipeline — tampered fixture (structurally invalid signature envelope)', () => {
  it('throws before buildRenderModel is ever reached — no render model, no dist output', () => {
    const signed = loadSampleIndex();
    signed.signatures = [{ ...signed.signatures[0]!, signature: '' }];
    const raw = JSON.stringify(signed);

    expect(() => {
      const verified = verifyAndParseIndex(raw, { now: NOW });
      buildRenderModel(verified.payload, { verified: verified.verified });
    }).toThrow(BuildError);
  });
});

describe('pipeline — schema-too-new fixture', () => {
  it('exits with the expected message substring, never a partial parse', () => {
    const signed = loadSampleIndex();
    signed.payload.schemaVersion = 2;
    const raw = JSON.stringify(signed);

    expect(() => verifyAndParseIndex(raw, { now: NOW })).toThrow(/upgrade the site generator/i);
  });
});

describe("pipeline — all-versions-yanked fixture (extends the sample index's own yanked 0.14.0 entry)", () => {
  it('generates a marker for "all versions yanked" and suppresses the install command', () => {
    const signed = loadSampleIndex();
    const postgres = signed.payload.connectors.find((c) => c.name === 'postgres')!;
    // Yank the one non-yanked version too, so every version of postgres is now yanked.
    const v0141 = postgres.versions.find((v) => v.version === '0.14.1')!;
    v0141.yanked = { reason: 'test: yanking the last remaining version for this fixture' };

    const verified = verifyAndParseIndex(JSON.stringify(signed), { now: NOW });
    const model = buildRenderModel(verified.payload, { verified: verified.verified });
    const rendered = model.connectors.find((c) => c.name === 'postgres')!;

    expect(rendered.effectiveStatus).toBe('yanked');
    expect(rendered.allVersionsYanked).toBe(true);
    expect(rendered.suppressInstallCommand).toBe(true);
  });
});

describe("pipeline — revoked-publisher fixture (the sample index's own example-vector-sink entry)", () => {
  it('renders the non-verified state for every version and carries the revocation reason verbatim', () => {
    const raw = loadSampleIndexRaw();
    const verified = verifyAndParseIndex(raw, { now: NOW });
    const model = buildRenderModel(verified.payload, { verified: verified.verified });
    const rendered = model.connectors.find((c) => c.name === 'example-vector-sink')!;

    expect(rendered.effectiveStatus).toBe('revoked');
    expect(rendered.versions.every((v) => v.verified === false)).toBe(true);
    expect(rendered.revoked?.reason).toContain('GITHUB_TOKEN with workflow-write scope');
    expect(rendered.suppressInstallCommand).toBe(true);
  });
});
