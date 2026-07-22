import type { Connector, ConnectorVersion } from './schema';

/**
 * The verified-badge derivation (step6-web-ui.md §4 — "the load-bearing part").
 *
 * THERE IS NO `verified` FIELD ANYWHERE IN THE SCHEMA. This module is the entire
 * definition of what "verified" means on this site — a pure function of already
 * -trusted fields, never a hand-set boolean, never an override file. If a future
 * change needs a connector to render as verified/not-verified against reality, the
 * fix is a change to the SIGNED INDEX DATA (a new signature, a yank, a revocation),
 * never a special case added here.
 *
 * Two-layer trust argument (restated from the plan, because it's the reason this
 * function is allowed to trust `signature`/`slsaProvenance` presence at all):
 *
 *   Layer 1 — by the time a version is merged into the signed index, index-CI has
 *   already independently re-fetched the artifact, recomputed its sha256, and
 *   re-run `cosign verify` against that connector name's PINNED identity. A version
 *   that failed that check was never merged. So "present in the merged index"
 *   already encodes "passed pinned-identity verification" for the common case.
 *
 *   Layer 2 — Layer 1 only holds if the index this site is reading is *actually*
 *   the one index-CI produced. That's why the site independently verifies the
 *   index's own root signature before rendering anything (see verifyIndex.ts) — a
 *   compromised CDN/origin serving a tampered index without ever touching an
 *   artifact or signature would otherwise be a laundering vector, since the UI
 *   never downloads artifacts itself.
 *
 * Residual risk, stated plainly (CLAUDE.md's "say what was actually verified"):
 * this site does NOT independently re-run `cosign verify`/Rekor-inclusion checks
 * per artifact at build time. It relies on index-CI having done that correctly
 * pre-merge. If index-CI's re-verification job has a bug or is bypassed, this site
 * inherits that error — it has no independent check of its own beyond the index's
 * own signature. Flagged, not silently deferred: a future hardening pass could add
 * build-time cosign re-verification of every artifact as a second belt-and-suspenders
 * layer, at the cost of fetching every artifact on every site build. Not recommended
 * for MVP (index-CI already gates every merge).
 *
 * Note (registry-plan-v2.md §7, "coherence 1.6 fix"): the schema requires
 * `artifact.signature` on every artifact, so "signed but missing a signature
 * reference" cannot occur in a schema-valid, merged index — there is no reachable
 * third "unverified — missing signature" UI state distinct from "not yet verified."
 * `hasSignaturePresent` below is still an explicit, defensive check (never crash on
 * a malformed artifact entry; treat it as unverified, not as verified-by-omission).
 */

/** True iff every artifact in this version carries a signature bundle reference. */
export function hasSignaturePresent(version: ConnectorVersion): boolean {
  return (
    version.artifacts.length > 0 && version.artifacts.every((a) => Boolean(a.signature?.bundleURL))
  );
}

/**
 * True iff SLSA provenance is present for this version — either as one
 * version-level attestation (the common goreleaser + slsa-github-generator shape)
 * or as a per-artifact attestation on every artifact (the schema explicitly allows
 * either shape; a client MUST accept both — see index-schema.json's `artifact`
 * def).
 */
export function hasProvenancePresent(version: ConnectorVersion): boolean {
  if (version.slsaProvenance?.bundleURL) return true;
  return (
    version.artifacts.length > 0 &&
    version.artifacts.every((a) => Boolean(a.slsaProvenance?.bundleURL))
  );
}

export function isYanked(version: ConnectorVersion): boolean {
  return Boolean(version.yanked);
}

export function isPublisherRevoked(connector: Connector): boolean {
  return Boolean(connector.publisher.revoked);
}

/**
 * `verified(version, connector)` is true iff:
 *   - the version has a signature reference present, AND
 *   - the version has a slsaProvenance reference present, AND
 *   - the version is not yanked, AND
 *   - the connector's publisher is not revoked.
 *
 * `publisher.revoked` overrides every individual version — including ones that
 * were correctly signed by the pinned identity before a compromise, matching the
 * schema's own semantics ("ALL versions under this connector name are considered
 * compromised regardless of individual yanked status").
 *
 * Deprecated is orthogonal to verified: a deprecated-but-signed version still
 * returns true here. Deprecation is a maintenance signal, not a trust signal.
 */
export function deriveVerified(version: ConnectorVersion, connector: Connector): boolean {
  if (isPublisherRevoked(connector)) return false;
  if (isYanked(version)) return false;
  return hasSignaturePresent(version) && hasProvenancePresent(version);
}
