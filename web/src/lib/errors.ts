/**
 * Build-fatal error classes. Every one of these, thrown anywhere in the pipeline
 * (scripts/build-site.mjs), must abort BEFORE `astro build` runs — no dist/, no
 * deploy, previous deployment stays live (registry-plan-v2.md / step6-web-ui.md §3,
 * §9 edge-case table). Each carries a distinct `code` so a CI dashboard/on-call can
 * tell "tampered" apart from "stale" apart from "unreachable" at a glance — never
 * one generic "index invalid" message.
 */

export type BuildErrorCode =
  | 'ERR_INDEX_UNREACHABLE'
  | 'ERR_INDEX_INTEGRITY'
  | 'ERR_INDEX_STALE'
  | 'ERR_INDEX_ROLLBACK'
  | 'ERR_SCHEMA_TOO_NEW'
  | 'ERR_RESERVED_ROUTE_COLLISION'
  | 'ERR_INDEX_MALFORMED';

export class BuildError extends Error {
  readonly code: BuildErrorCode;

  constructor(code: BuildErrorCode, message: string) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}
