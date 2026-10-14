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

## What a listing does and does not attest

An entry pins two things per artifact: a keyless cosign signature from the connector repository's own
`publish.yml` at a release tag (`publisher.expectedIdentityPattern`), and SLSA provenance from
`slsa-github-generator`. Together they say which repository and workflow built the artifact, from which commit,
on a GitHub-hosted runner.

They do not attest the code of the actions that workflow called. In particular, the provenance does not record
which `ConduitIO/connector-publish-action` code ran the build and signing steps. A workflow that calls the action
by a moving tag (`@v1`) builds with whatever that tag pointed to at the time. That is why connector publish
workflows pin `ConduitIO/connector-publish-action` and `actions/checkout` to full commit SHAs, and why a reviewer
of a new entry checks the pin in the tagged `publish.yml`, not only the signature.

`tier` and `license` are display metadata set by registry maintainers. No install or verification decision reads
them. `index/ci/validate_entries.py` (run on every pull request and before every signing) checks entry files
against the schema, ties each entry's identity pattern and URLs to its own repository, and refuses two connectors
with the same plugin spec name (`index/ci/spec-names.json`).
