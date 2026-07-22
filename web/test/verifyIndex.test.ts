import { describe, expect, it } from 'vitest';
import { verifyAndParseIndex, checkFreshness, checkSchemaVersion } from '../src/lib/verifyIndex';
import { BuildError } from '../src/lib/errors';
import {
  loadSampleIndex,
  loadSampleIndexRaw,
  SAMPLE_INDEX_TIMESTAMP,
} from './fixtures/loadFixture';

const NOW = new Date(SAMPLE_INDEX_TIMESTAMP);

describe('verifyAndParseIndex — valid index', () => {
  it('parses the real sample index successfully, cryptographically unverified (stub)', () => {
    const raw = loadSampleIndexRaw();
    const result = verifyAndParseIndex(raw, { now: NOW });
    expect(result.payload.connectors.length).toBeGreaterThan(0);
    // Structural belt-and-suspenders flag — must be false until PR-2's real
    // verifier lands. See src/lib/verifyIndex.ts's VerifiedIndex doc comment.
    expect(result.verified).toBe(false);
  });
});

describe('verifyAndParseIndex — malformed / not-even-shaped-right index (ERR_INDEX_MALFORMED)', () => {
  it('rejects non-JSON', () => {
    expect(() => verifyAndParseIndex('not json{{{', { now: NOW })).toThrowError(BuildError);
    try {
      verifyAndParseIndex('not json{{{', { now: NOW });
    } catch (err) {
      expect((err as BuildError).code).toBe('ERR_INDEX_MALFORMED');
    }
  });

  it('rejects a JSON object missing `payload`', () => {
    expect(() =>
      verifyAndParseIndex(JSON.stringify({ signatures: [{}] }), { now: NOW })
    ).toThrowError(BuildError);
  });

  it('rejects an empty `signatures` array (schema requires minItems: 1)', () => {
    const signed = loadSampleIndex();
    signed.signatures = [];
    expect(() => verifyAndParseIndex(JSON.stringify(signed), { now: NOW })).toThrow(/signatures/);
  });
});

describe('verifyAndParseIndex — tampered signature envelope (ERR_INDEX_INTEGRITY)', () => {
  it('rejects a signature entry missing `role: root` — no valid root signature to trust', () => {
    const signed = loadSampleIndex();
    signed.signatures = [{ ...signed.signatures[0]!, role: 'freshness' }];
    expect(() => verifyAndParseIndex(JSON.stringify(signed), { now: NOW })).toThrow(/root/i);
  });

  it('rejects a signature entry with an empty signature value', () => {
    const signed = loadSampleIndex();
    signed.signatures = [{ ...signed.signatures[0]!, signature: '' }];
    try {
      verifyAndParseIndex(JSON.stringify(signed), { now: NOW });
      expect.fail('expected verifyAndParseIndex to throw');
    } catch (err) {
      expect((err as BuildError).code).toBe('ERR_INDEX_INTEGRITY');
    }
  });

  it(
    'KNOWN GAP (flagged, not silently papered over): mutating sha256/url/expectedIdentityPattern ' +
      'while leaving the (structurally intact, still-stubbed) signature envelope untouched is NOT ' +
      'caught by this stub — only real ed25519 verification (PR-2) closes this hole. This test ' +
      'documents the gap rather than pretending it is covered.',
    () => {
      const signed = loadSampleIndex();
      signed.payload.connectors[0]!.versions[0]!.artifacts[0]!.sha256 = 'f'.repeat(64);
      // Does NOT throw today — this is the documented residual risk from
      // src/lib/verifyIndex.ts's verifyRootSignature TODO.
      expect(() => verifyAndParseIndex(JSON.stringify(signed), { now: NOW })).not.toThrow();
    }
  );
});

describe('verifyAndParseIndex — schema too new (ERR_SCHEMA_TOO_NEW)', () => {
  it('refuses with an explicit "upgrade the site generator" message, not a partial render', () => {
    const signed = loadSampleIndex();
    signed.payload.schemaVersion = 999;
    try {
      checkSchemaVersion(signed.payload);
      expect.fail('expected checkSchemaVersion to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BuildError);
      expect((err as BuildError).code).toBe('ERR_SCHEMA_TOO_NEW');
      expect((err as BuildError).message).toMatch(/upgrade the site generator/i);
    }
  });

  it('is checked before any typed access to `connectors` — verifyAndParseIndex throws before deriving anything', () => {
    const signed = loadSampleIndex();
    signed.payload.schemaVersion = 999;
    expect(() => verifyAndParseIndex(JSON.stringify(signed), { now: NOW })).toThrowError(
      BuildError
    );
  });
});

describe('checkFreshness — stale vs. rollback are distinct, never-conflated fixtures', () => {
  it('accepts an index within the staleness window', () => {
    const signed = loadSampleIndex();
    expect(() => checkFreshness(signed.payload, 30 * 24 * 60 * 60 * 1000, NOW)).not.toThrow();
  });

  it('rejects an index older than maxStalenessMs with ERR_INDEX_STALE (distinct from integrity failures)', () => {
    const signed = loadSampleIndex();
    const veryOld = new Date(new Date(SAMPLE_INDEX_TIMESTAMP).getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days later
    try {
      checkFreshness(signed.payload, 30 * 24 * 60 * 60 * 1000, veryOld);
      expect.fail('expected checkFreshness to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BuildError);
      expect((err as BuildError).code).toBe('ERR_INDEX_STALE');
    }
  });
});
