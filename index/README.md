# index/

This directory is the future home of the signed connector registry index: per-connector source
files, index-CI verification tooling, and the signed-index build (PR-2/PR-3 of the connector
registry MVP, `registry-plan-v2.md` §2.1/§8).

## Current state (scaffold only — no signing yet)

`index.json` in this directory is an **assembled fixture**: `payload.connectors[]` is built from
`connectors/*.json` and `payload.processors[]` from `processors/*.json` (see `cmd/index-sign`), at
schemaVersion 1. It exists so the web UI (`web/`, PR-5) has something real to build against before
the trust core and root-key custody land. It carries one connector (`file`) and one processor
(`conduit-processor-ai`, the arch-neutral `wasip1/wasm` shape added by the conduit registry index's
processor-artifacts change) so both collection shapes are exercised end-to-end.

**This is not a trustworthy signed index.** The `signatures[]` block is **stale relative to the
current payload** — it was produced by an earlier `index-sign` run over the connector-only,
version-2 payload, and this file's payload has since gained `processors[]` and bumped to version 3
without a re-sign (no ceremony key is available in a local checkout). The real, matching signature
is produced by the `index-sign` workflow (`.github/workflows/index-sign.yml`), which assembles
`connectors[]` + `processors[]` and root-signs with the custodied ceremony key. Treat every fact in
this file as a fixture, not a trust claim.

`index-schema.json` is copied alongside it (also frozen, schemaVersion 1) so this repo is
self-contained for schema validation without reaching back into `ConduitIO/conduit`. It is kept
**byte-identical** to the authoritative copy at
`docs/design-documents/registry-index/index-schema.json` in `ConduitIO/conduit` (the two are the
same document); re-sync by copying that file over this one whenever the frozen schema changes.

## What's still missing (tracked against PR-2 / the bootstrap)

- Root and freshness ed25519 key generation, and the GitHub Environment + required-reviewers gate
  that custodies them (registry-plan-v2.md §1, "Root-key custody").
- Real per-connector, per-artifact cosign signatures and SLSA L3 provenance (registry-plan-v2.md
  §9, seed-index bootstrap Phase 1 — the six seed connectors: postgres, kafka, s3, generator,
  file, log).
- index-CI: the re-verification job that re-fetches every artifact, recomputes its sha256, and
  re-runs `cosign verify` against the pinned identity before merging any content change
  (registry-plan-v2.md §2.1, §10's reviewer checklist).
- Real root/freshness signatures replacing the placeholder value above.

Until that lands, `web/`'s build pipeline treats this file as **structurally valid but
unverified** — see `web/src/lib/verifyIndex.ts` for the stubbed verification step and its TODO.

## Layout (once the bootstrap lands)

```text
index/
  index-schema.json   # frozen schemaVersion-1 JSON Schema (byte-identical mirror of ConduitIO/conduit)
  index.json           # the live signed index (currently: assembled fixture, stale signature)
  connectors/           # per-connector source files index-sign assembles into index.json (connectors[])
  processors/           # per-processor source files index-sign assembles into index.json (processors[])
  ci/                    # index-CI re-verification tooling (TODO, PR-2)
```
