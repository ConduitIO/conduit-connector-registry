/**
 * Typed mirror of `index/index-schema.json` (schemaVersion 1, frozen — see
 * `docs/design-documents/registry-index/index-schema.json` in ConduitIO/conduit).
 *
 * This module has ZERO business logic — it is a structural description of the signed
 * payload only. Every derived fact (verified, effective status, default version) lives
 * in sibling modules (`deriveVerified.ts`, `effectiveStatus.ts`, `pickDefaultVersion.ts`)
 * so the "what does the schema say" and "what do we conclude from it" concerns never
 * mix in one file.
 */

export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

export interface SignatureRef {
  bundleURL: string;
  rekorLogIndex?: number;
}

export interface ProvenanceRef {
  bundleURL: string;
  predicateType: string;
}

export interface Revocation {
  reason: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface YankReason {
  reason: string;
  yankedAt?: string;
  yankedBy?: string;
}

export type ArtifactOS = 'linux' | 'darwin' | 'windows';
export type ArtifactArch = 'amd64' | 'arm64';
export type ArtifactKind = 'standalone' | 'wasm';

export interface Artifact {
  os: ArtifactOS;
  arch: ArtifactArch;
  kind: ArtifactKind;
  url: string;
  sha256: string;
  size: number;
  signature: SignatureRef;
  slsaProvenance?: ProvenanceRef;
}

export interface ConnectorVersion {
  version: string;
  releasedAt?: string;
  minConduitVersion: string;
  minProtocolVersion: string;
  artifacts: Artifact[];
  slsaProvenance?: ProvenanceRef;
  deprecated?: boolean;
  yanked?: YankReason;
}

export interface Publisher {
  expectedOIDCIssuer: string;
  expectedIdentityPattern: string;
  revoked?: Revocation;
}

export interface Connector {
  name: string;
  displayName?: string;
  description?: string;
  repository?: string;
  publisher: Publisher;
  versions: ConnectorVersion[];
}

export interface IndexMeta {
  version: number;
  timestamp: string;
}

export interface IndexPayload {
  schemaVersion: number;
  index: IndexMeta;
  connectors: Connector[];
}

export interface IndexSignature {
  role: 'root' | 'freshness';
  keyId: string;
  algorithm: 'ed25519' | 'ecdsa-p256-sha256';
  signature: string;
}

export interface SignedIndex {
  payload: IndexPayload;
  signatures: IndexSignature[];
}

/** All OS x arch pairs the compatibility matrix always renders, per schema enum. */
export const ALL_OS: readonly ArtifactOS[] = ['linux', 'darwin', 'windows'];
export const ALL_ARCH: readonly ArtifactArch[] = ['amd64', 'arm64'];
