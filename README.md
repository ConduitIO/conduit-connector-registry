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
by a moving tag (`@v1`) builds with whatever that tag pointed to at the time.

Going forward, a connector's `publish.yml` must pin `ConduitIO/connector-publish-action` and `actions/checkout`
to full commit SHAs. A reviewer adding a new entry or version checks the pin in `publish.yml` at the release tag,
not only the signature. As of 2026-10-14 no listed connector meets this yet: the core connectors call `@v1` and
`actions/checkout@v4`, and `pgvector` pins the action to the `v1.0.7` tag, which is still movable. The nine
community connectors were released from `@v1` and `@v4`, and their pin pull requests are open:
[activemq-artemis#83](https://github.com/conduitio-labs/conduit-connector-activemq-artemis/pull/83),
[kinesis#573](https://github.com/conduitio-labs/conduit-connector-kinesis/pull/573),
[materialize#153](https://github.com/conduitio-labs/conduit-connector-materialize/pull/153),
[mongo#204](https://github.com/conduitio-labs/conduit-connector-mongo/pull/204),
[neo4j#135](https://github.com/conduitio-labs/conduit-connector-neo4j/pull/135),
[pulsar#91](https://github.com/conduitio-labs/conduit-connector-pulsar/pull/91),
[rabbitmq#90](https://github.com/conduitio-labs/conduit-connector-rabbitmq/pull/90),
[redis#194](https://github.com/conduitio-labs/conduit-connector-redis/pull/194),
[sqs#617](https://github.com/conduitio-labs/conduit-connector-sqs/pull/617).

The nine listed releases were checked after the fact: the GitHub Actions job logs of each release's publish run
show `ConduitIO/connector-publish-action@v1` resolving to `e527dd06c971596b2020d682258fbe50bef62411` (v1.0.7)
and `actions/checkout@v4` to `11d5960a326750d5838078e36cf38b85af677262` (v4.4.0), in both the build and
register jobs. Those logs expire, so this sentence is the durable record.

`tier` and `license` are display metadata set by registry maintainers. No install or verification decision reads
them. `index/ci/validate_entries.py` (run on every pull request and before every signing) checks entry files
against the schema, allows only `ConduitIO` and `conduitio-labs` repositories, ties each entry's identity pattern
to that repository's `publish.yml` at a tag and its URLs to that repository's releases, and refuses two connectors
with the same plugin spec name (`index/ci/spec-names.json`). `index/ci/check_spec_names.py` (every pull request)
checks each recorded spec name against the connector's source at every listed release tag.
