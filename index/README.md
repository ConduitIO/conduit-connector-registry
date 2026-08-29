# index/

This directory is the home of the signed connector registry index: per-connector source files,
the assembled signed index, and (TODO) index-CI verification tooling.

## Current state (trust-core bootstrap done — root-signed since 2026-08)

`index.json` is the **live signed index**: `payload.connectors[]` is assembled from
`connectors/*.json` and `payload.processors[]` from `processors/*.json` by `cmd/index-sign`
at schemaVersion 1, then root-signed with the ceremony key (custodied in the
`registry-signing` GitHub Environment) and committed to `main` by the `index-sign` workflow
(`.github/workflows/index-sign.yml`). It is published build-free at
`https://index.conduitdata.io/index.json` by `deploy.yml` (WS4 S6) — the canonical index
publication path, with no UI build in it. The CLI's default URL
(`https://registry.conduitdata.io/index.json`, `registry.DefaultIndexURL`) never moves; it is
served by the UI repo's build output (`ConduitIO/conduit-registry-ui`, `dist/index.json`
byte-copy) or this repo's Pages project in the interim.

`index-schema.json` is copied alongside the index (frozen, schemaVersion 1) so this repo is
self-contained for schema validation without reaching back into `ConduitIO/conduit`. It is
kept **byte-identical** to the authoritative copy at
`docs/design-documents/registry-index/index-schema.json` in `ConduitIO/conduit` (the two are
the same document); re-sync by copying that file over this one whenever the frozen schema
changes.

Every content change and every freshness re-sign goes through `index-sign.yml` — **root is
the only dispatchable role**, and a freshness-only envelope is never publishable (it is what
broke the published index on 2026-08-21; the workflow's header documents why). The structural
gate in `.github/workflows/ci.yml` (`index-gate.py`) asserts the committed envelope is shaped
like an index consumers would accept before any PR or publish; the crypto is the ceremony's
job, and a full signature-verification gate is the UI repo's S2 build (it verifies the
published bytes with the conduit CLI's own verifier + compiled-in trust anchors).

## What's still missing

- **index-CI**: the re-verification job that re-fetches every artifact, recomputes its
  sha256, and re-runs `cosign verify` against the pinned identity before merging any content
  change (registry-plan-v2.md §2.1, §10's reviewer checklist). Made non-blocking for the
  badge by the UI repo's S2/S3 build-time verification (the site verifies for itself); still
  a registry-repo improvement, not a WS4 dependency.
- **Detached freshness liveness**: a freshness-signed liveness document separate from the
  index, with client support — filed for v0.21 (`registry-28-freshness-heartbeat.md`, option
  C). Until then the `index-staleness-alarm.yml` alarm + human-dispatched `role: root`
  re-sign is the liveness mechanism.

## Layout

```text
index/
  index-schema.json   # frozen schemaVersion-1 JSON Schema (byte-identical mirror of ConduitIO/conduit)
  index.json          # the live signed index (root-signed by the index-sign ceremony)
  connectors/         # per-connector source files index-sign assembles into index.json (connectors[])
  processors/         # per-processor source files index-sign assembles into index.json (processors[])
  ci/                 # index-CI re-verification tooling (TODO)
```
