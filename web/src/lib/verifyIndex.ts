import type { IndexPayload, IndexSignature, SignedIndex } from './schema';
import { MAX_SUPPORTED_SCHEMA_VERSION } from './schema';
import { BuildError } from './errors';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `now - index.timestamp` beyond which the build refuses as stale. R-1's own spec
 * (`docs/design-documents/registry-index/index-schema.json`, `index.timestamp`
 * doc comment) states the max-staleness value is an open question — 30 days is a
 * deliberately generous placeholder until that's resolved, overridable via
 * `REGISTRY_MAX_STALENESS_MS` for tests/ops. Tightening this is a config change,
 * not a code change.
 */
export const DEFAULT_MAX_STALENESS_MS = 30 * DAY_MS;

export interface VerifiedIndex {
  payload: IndexPayload;
  /**
   * Mirrors `index.VerifiedIndex.Verified` from registry-plan-v2.md §2.2 — a
   * structural belt-and-suspenders flag so a caller can never mistake a
   * stub-parsed result for a cryptographically trusted one. ALWAYS false until
   * PR-2's real verifier lands (see verifyRootSignature below). Nothing in this
   * repo is permitted to treat `verified: false` data as authorization for a
   * security decision — the per-version badge (deriveVerified.ts) reasons about
   * signature/provenance *references already inside the payload*, which is a
   * separate, narrower claim than "this envelope's root signature checked out."
   */
  verified: boolean;
}

/**
 * Structural-only parse: confirms the JSON matches the envelope shape (payload +
 * signatures[], each signature has role/keyId/algorithm/signature) WITHOUT making
 * any trust claim. Mirrors `index.ParseUnverified` in registry-plan-v2.md §2.2 —
 * the doc comment there is equally explicit that this makes no claim about the
 * `signatures` envelope being valid, just present and well-shaped.
 *
 * Throws `ERR_INDEX_MALFORMED` for anything that isn't even the right shape to
 * evaluate (can't extract `payload`/`signatures` at all).
 */
export function parseUnverified(raw: string): SignedIndex {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new BuildError(
      'ERR_INDEX_MALFORMED',
      `index is not valid JSON: ${(err as Error).message}`
    );
  }

  if (typeof json !== 'object' || json === null) {
    throw new BuildError('ERR_INDEX_MALFORMED', 'index root is not a JSON object');
  }
  const obj = json as Record<string, unknown>;

  if (typeof obj['payload'] !== 'object' || obj['payload'] === null) {
    throw new BuildError('ERR_INDEX_MALFORMED', 'index is missing a `payload` object');
  }
  if (!Array.isArray(obj['signatures']) || obj['signatures'].length === 0) {
    throw new BuildError(
      'ERR_INDEX_MALFORMED',
      'index is missing a non-empty `signatures` array (schema requires minItems: 1)'
    );
  }

  return json as SignedIndex;
}

/** Refuses (`ERR_SCHEMA_TOO_NEW`) any payload whose `schemaVersion` exceeds what
 * this generator understands — never a best-effort/partial render (step6-web-ui.md
 * §9). This check MUST run before any typed access to `payload.connectors`. */
export function checkSchemaVersion(payload: IndexPayload): void {
  if (payload.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new BuildError(
      'ERR_SCHEMA_TOO_NEW',
      `index schemaVersion ${payload.schemaVersion} exceeds the highest this site generator ` +
        `understands (${MAX_SUPPORTED_SCHEMA_VERSION}) — upgrade the site generator before it can ` +
        `build this index.`
    );
  }
}

/**
 * TODO(registry-bootstrap, tracked against registry-plan-v2.md §3 step 3 / §9):
 * this is a STUB. Real verification must re-use the shared Go verifier
 * (`pkg/registry/index.Verify`, backed by JCS/RFC-8785 canonicalization + ed25519
 * against the compiled-in registry root/freshness public keys) via a small CLI
 * invocation — the plan is explicit that reimplementing JCS canonicalization and
 * ed25519 verification in TypeScript here would be exactly the "one verifier, two
 * callers" drift CLAUDE.md's simplicity bar warns against. That CLI does not exist
 * yet (it ships with PR-2/the trust core), and no real signing key has been
 * generated (index/README.md), so there is nothing to shell out to.
 *
 * Until that lands, this function performs a STRUCTURAL check only — every
 * `signatures[]` entry has the required fields with the right shapes/enums — and
 * returns `verified: false` unconditionally. It intentionally does NOT throw for
 * a structurally well-formed-but-uncryptographically-checked signature, because
 * doing so would make every build fail today (there is no real signed index to
 * pass). It DOES throw `ERR_INDEX_INTEGRITY` for anything structurally wrong with
 * the signature envelope (missing role, unrecognized algorithm, empty signature
 * bytes) — a legitimate stand-in for "this could not possibly verify," and the
 * exact error code PR-2's real ed25519 check will also throw on a genuine
 * cryptographic failure, so this code path and its message are stable across the
 * stub -> real cutover.
 *
 * Known, flagged gap (CLAUDE.md: "say what was actually verified, not assumed"):
 * a payload whose `sha256`/`url`/`expectedIdentityPattern` fields are mutated but
 * whose `signatures[]` envelope is left structurally intact (i.e., an attacker who
 * also forges/reuses a structurally-valid-looking signature blob) will NOT be
 * caught by this stub. Only real ed25519 verification (PR-2) closes that hole.
 * This gap is called out explicitly in this PR's description — it is not silently
 * papered over by this comment alone.
 */
export function verifyRootSignature(signed: SignedIndex): { verified: boolean; stubbed: true } {
  const rootSig = signed.signatures.find(
    (s) => isStructurallyValidSignature(s) && s.role === 'root'
  );
  if (!rootSig) {
    throw new BuildError(
      'ERR_INDEX_INTEGRITY',
      'index has no structurally valid `root`-role signature entry — refusing to render from it'
    );
  }
  // Deliberately loud: this must never be missed in build logs.
  console.warn(
    '[registry-web] WARNING: index root signature verification is STUBBED (no real crypto check ' +
      'performed). See src/lib/verifyIndex.ts TODO. This build is NOT independently verifying the ' +
      'index against a trust anchor.'
  );
  return { verified: false, stubbed: true };
}

function isStructurallyValidSignature(sig: IndexSignature): boolean {
  return (
    (sig.role === 'root' || sig.role === 'freshness') &&
    typeof sig.keyId === 'string' &&
    sig.keyId.length > 0 &&
    (sig.algorithm === 'ed25519' || sig.algorithm === 'ecdsa-p256-sha256') &&
    typeof sig.signature === 'string' &&
    sig.signature.length > 0
  );
}

/** Refuses (`ERR_INDEX_STALE`) an index older than `maxStalenessMs`. Distinct code
 * from integrity failures so on-call can tell "tampered" apart from "stale" at a
 * glance (step6-web-ui.md §3 step 4). */
export function checkFreshness(
  payload: IndexPayload,
  maxStalenessMs: number = DEFAULT_MAX_STALENESS_MS,
  now: Date = new Date()
): void {
  const ts = Date.parse(payload.index.timestamp);
  if (Number.isNaN(ts)) {
    throw new BuildError(
      'ERR_INDEX_MALFORMED',
      `index.timestamp "${payload.index.timestamp}" is not a valid date`
    );
  }
  const ageMs = now.getTime() - ts;
  if (ageMs > maxStalenessMs) {
    throw new BuildError(
      'ERR_INDEX_STALE',
      `index.timestamp (${payload.index.timestamp}) is ${Math.round(ageMs / DAY_MS)} days old, ` +
        `exceeding the max staleness of ${Math.round(maxStalenessMs / DAY_MS)} days`
    );
  }
}

/**
 * Full pipeline: parse -> schema-version gate -> (stubbed) signature verification
 * -> freshness. Order matters: schema-version is checked before any typed access,
 * and the signature check happens before freshness is trusted (freshness reads a
 * payload field that only Layer-2 verification makes trustworthy in the real
 * implementation — kept in this order now so the cutover to real crypto doesn't
 * need to reorder these calls).
 */
export function verifyAndParseIndex(
  raw: string,
  opts: { maxStalenessMs?: number; now?: Date } = {}
): VerifiedIndex {
  const signed = parseUnverified(raw);
  checkSchemaVersion(signed.payload);
  const { verified } = verifyRootSignature(signed);
  checkFreshness(signed.payload, opts.maxStalenessMs, opts.now);
  return { payload: signed.payload, verified };
}
