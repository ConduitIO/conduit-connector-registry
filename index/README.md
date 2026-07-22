# index/

This directory is the future home of the signed connector registry index: per-connector source
files, index-CI verification tooling, and the signed-index build (PR-2/PR-3 of the connector
registry MVP, `registry-plan-v2.md` §2.1/§8).

## Current state (scaffold only — no signing yet)

`index.json` in this directory is currently a **direct copy of the frozen schema's own fixture**,
`docs/design-documents/registry-index/sample-index.json` from `ConduitIO/conduit`
(schemaVersion 1). It exists so the web UI (`web/`, PR-5) has something real to build against
before the trust core and root-key custody land.

**This is not a signed index.** The `signatures` array contains a literal placeholder value
(`"MEUCIQDN6placeholder8SIGNATURE8bytes8..."`) — it does not verify against any real key, because
no registry root key has been generated yet. Treat every fact in this file as a fixture, not a
trust claim.

`index-schema.json` is copied alongside it (also frozen, schemaVersion 1) so this repo is
self-contained for schema validation without reaching back into `ConduitIO/conduit`.

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
  index-schema.json   # frozen schemaVersion-1 JSON Schema (copied from ConduitIO/conduit)
  index.json           # the live signed index (currently: unsigned fixture copy)
  connectors/           # per-connector source files index-CI assembles into index.json (TODO)
  ci/                    # index-CI re-verification tooling (TODO, PR-2)
```
