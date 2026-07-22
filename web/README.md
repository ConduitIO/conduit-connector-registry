# web/ — the registry's public web UI

Static site generated entirely at build time from the signed connector registry index
(`../index/index.json`). No backend, no client-side fetch-and-render of the catalog — every
connector fact on every page traces back to a field in the index, rendered as real, crawlable
HTML that's fully present with JavaScript disabled.

## Stack

**Astro (static output) + React islands**, not a Vite CSR SPA. Astro ships zero client JS by
default and opts individual components into hydration explicitly; the two islands here are the
search box (`src/components/SearchBox.tsx`) and the copy-install-command button
(`src/components/CopyInstallButton.tsx`). Every badge/tag/banner/compat-cell renders as plain
server-generated HTML with no hydration. See
`conduit-registry-plans/step6-web-ui.md` §1 for the full rationale (this repo doesn't vendor that
doc; it lives in the planning repo).

Shared visual language with `conduit-ui` (the in-engine built-in UI): `src/styles/tokens.css` is a
verbatim copy of that repo's `src/tokens/tokens.css` (see `.github/workflows/token-drift.yml` for
the scheduled drift check). Components follow `StatusPill`'s pattern (aria-hidden glyph + visible
text label + CSS-variable color) but are new code, not copies — connector trust/lifecycle state is
a different domain from pipeline run-state.

## The verified badge

There is no `verified` field in the index schema. `src/lib/deriveVerified.ts` is the entire
definition: a version is verified iff it has a signature reference, a SLSA provenance reference,
is not yanked, and its connector's publisher is not revoked — a pure function of already-signed
index data, never a hand-set boolean or an override file. Read that file's doc comment for the
two-layer trust argument and the one residual gap it states plainly (this site does not
independently re-run `cosign verify` per artifact; it relies on index-CI having done that
pre-merge).

## Build pipeline (`npm run build`, `scripts/build-site.ts`)

1. Read `../index/index.json` (no network hop for the primary path).
2. Verify the index's root signature — **currently stubbed** with a loud, explicit TODO
   (`src/lib/verifyIndex.ts`) until the trust-core bootstrap ships a real verifier. Structural
   integrity (malformed envelope, schema-too-new) still hard-fails the build today.
3. Freshness check.
4. Derive the render model (every computed fact — verified, effective status, default version,
   compat matrix — computed once, here).
5. Fetch Scarf download stats, best-effort (never fails the build).
6. `astro build`.
7. Copy `index.json` byte-for-byte into `dist/` and verify the copy — this must never be a
   re-serialization, since the detached signature is computed over exact bytes.

A failure at steps 1-4 exits non-zero **before** `astro build` ever runs: no `dist/`, no deploy.

## Scripts

| Command                                 | Purpose                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                           | Astro dev server                                                                    |
| `npm run build`                         | The full pipeline above                                                             |
| `npm run typecheck`                     | `astro check` (TypeScript, strict)                                                  |
| `npm run lint` / `npm run format:check` | ESLint (jsx-a11y on) / Prettier                                                     |
| `npm test`                              | Vitest unit + component + build-pipeline-integration tests                          |
| `npm run axe`                           | Automated a11y scan (axe-core via real headless Chromium) against the built `dist/` |
| `npm run smoke:deployed`                | Post-deploy check: byte-compares the live `/index.json`, checks the list page       |
| `npm run check:tokens`                  | Diffs `tokens.css` against `conduit-ui`'s copy (used by the scheduled Action)       |

## Known, flagged gaps (not silently deferred)

- Index root-signature verification is structural-only until the trust-core bootstrap ships a
  real Go verifier CLI to shell out to (`src/lib/verifyIndex.ts`'s `verifyRootSignature` TODO).
- Scarf stats fetch targets a placeholder endpoint shape; falls back to "unavailable" until real
  API access is provisioned (`scripts/fetchScarfStats.ts`).
- No `deprecated` or `all-versions-yanked` connector exists in the current fixture data, so the
  a11y scan's four-status-variant coverage is currently active + revoked only for full-page
  scans; the `deprecated`/`yanked` component states are covered at the component level instead
  (`test/components.test.tsx`).
