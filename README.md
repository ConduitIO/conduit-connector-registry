# conduit-connector-registry

Signed connector registry: the index `conduit connectors install` resolves against, plus the
static web UI. TUF-lite signed, cosign/SLSA-verified.

## Layout

```text
conduit-connector-registry/
  index/     # the signed index (index.json) + schema. Currently a scaffold — see index/README.md
             # for what's real today vs. what ships with the trust-core bootstrap.
  web/       # the public web UI: an Astro (static output) + React-islands site, generated
             # entirely at build time from index/index.json. No backend, no client-side
             # fetch-and-render. See web/README.md (or the PR that introduced it) for the
             # stack rationale, build pipeline, and verified-badge derivation.
```

One GitHub Pages deployment serves both the human-facing site and the machine-readable
`/index.json` — the exact URL `conduit connectors install` fetches by default.

## Status

Both directories are scaffolds today. `index/index.json` is an unsigned fixture (a copy of
`ConduitIO/conduit`'s frozen `sample-index.json`) until the trust-core bootstrap generates a real
root key and signs a real index. `web/` builds and deploys against that fixture now, with its
signature-verification step stubbed and clearly flagged — see `index/README.md` and
`web/src/lib/verifyIndex.ts` for exactly what's real vs. pending.
