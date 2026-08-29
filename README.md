# conduit-connector-registry

Signed connector registry: the index `conduit connectors install` resolves against. TUF-lite
signed, cosign/SLSA-verified.

## Layout

```text
conduit-connector-registry/
  index/     # the signed index (index.json) + schema + the per-connector/processor source
             # files the ceremony assembles it from. See index/README.md.
  cmd/       # index-sign: the ceremony signer (assembles + root-signs index/index.json)
  .github/   # workflows: index-sign.yml (ceremony), deploy.yml (publication), ci.yml
             # (structural index gate), index-staleness-alarm.yml (72h freshness alarm),
             # root-keygen.yml (key custody bootstrap), go-ci.yml (signer round-trip tests)
```

## What this repo owns

- **The signed index** (`index/index.json`), served **build-free** at
  `https://index.conduitdata.io/index.json` — the canonical index publication path (WS4 S6,
  amended AC 4.10). A re-sign (`.github/workflows/index-sign.yml`) commits the signed
  envelope; `deploy.yml` publishes it to GitHub Pages with **no UI build in the path**, then
  dispatches `repository_dispatch(registry-index-updated)` to `ConduitIO/conduit-registry-ui`
  so the site rebuilds (AC 4.11). The canonical URL never moves.
- The web UI that renders the index **no longer lives here** — it moved to
  `ConduitIO/conduit-registry-ui` (WS4 S6), deployed at `https://registry.conduitdata.io`.
  The index bytes the CLI fetches by default (`registry.DefaultIndexURL`,
  `https://registry.conduitdata.io/index.json`) are served by that site's build output
  (`dist/index.json`, a byte-copy of the verified index) — the same signed bytes, one
  publishing path with no UI build in it.

## Status

The trust-core bootstrap is **done**: `index/index.json` is a live, root-signed index —
ed25519 `root`-role signature over the JCS-canonicalized payload, produced by the ceremony
signer (`cmd/index-sign`, which imports `pkg/registry/index` from `ConduitIO/conduit` so
signer and verifier cannot drift). The root key is custodied in the `registry-signing`
GitHub Environment (see `root-keygen.yml`); every use is a gated, human-dispatched run of
`index-sign.yml`. What remains is tracked in `index/README.md` (index-CI is still missing;
detached freshness liveness is a v0.21 item, see `index-sign.yml`'s header).
