#!/usr/bin/env tsx
/**
 * The registry site's own build orchestrator (step6-web-ui.md §3). Each numbered
 * step is a hard gate for the ones after it unless marked "best-effort" — a
 * failure at steps 1-4 or 8 (typecheck happens via `astro check` in CI, not
 * here) must exit non-zero BEFORE `astro build` ever runs, so there is never a
 * partial/empty dist/ and never a deploy from bad data. Steps:
 *
 *   1. Obtain the signed index (read from disk — no network hop for the
 *      primary path; index/ and web/ are colocated in this repo).
 *   2. Verify the index's own root signature (STUBBED — see src/lib/verifyIndex.ts).
 *   3. Freshness check.
 *   4. Derive the render model (every derived field computed once, here).
 *   5. Fetch Scarf stats — BEST-EFFORT, never fails the build.
 *   6. Write the generated render-model.json + public/search-manifest.json
 *      Astro's pages/build consume.
 *   7. Run `astro build`.
 *   8. Copy index.json BYTE-FOR-BYTE into dist/ (never re-serialized — see the
 *      comment at COPY_INDEX below) and verify the copy.
 *
 * The a11y scan (scripts/axe-scan.ts), deploy, and post-deploy smoke check
 * (scripts/post-deploy-smoke.ts) are separate CI workflow steps, run in that
 * order AFTER this script exits 0 — see .github/workflows/ci.yml /
 * deploy.yml. They stay separate scripts so each is independently testable and
 * runnable locally without needing a live deploy target.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyAndParseIndex, DEFAULT_MAX_STALENESS_MS } from '../src/lib/verifyIndex';
import { buildRenderModel } from '../src/lib/renderModel';
import { mergeScarfStats } from '../src/lib/scarfStats';
import { fetchAllScarfStats } from './fetchScarfStats';
import { BuildError } from '../src/lib/errors';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');

const INDEX_PATH = process.env['REGISTRY_INDEX_PATH'] ?? path.join(repoRoot, 'index', 'index.json');
const GENERATED_DIR = path.join(webRoot, '.generated');
const RENDER_MODEL_PATH = path.join(GENERATED_DIR, 'render-model.json');
const PUBLIC_DIR = path.join(webRoot, 'public');
const SEARCH_MANIFEST_PATH = path.join(PUBLIC_DIR, 'search-manifest.json');
const DIST_DIR = path.join(webRoot, 'dist');

async function main(): Promise<void> {
  console.log(`[registry-web] reading index from ${INDEX_PATH}`);
  if (!existsSync(INDEX_PATH)) {
    throw new BuildError('ERR_INDEX_UNREACHABLE', `index file not found at ${INDEX_PATH}`);
  }
  const rawBuffer = readFileSync(INDEX_PATH);
  const raw = rawBuffer.toString('utf-8');

  // Steps 2-3: verify (stubbed) + freshness. Throws BuildError on any failure —
  // caught in run() below, which exits non-zero before astro build is invoked.
  const maxStalenessMs = process.env['REGISTRY_MAX_STALENESS_MS']
    ? Number(process.env['REGISTRY_MAX_STALENESS_MS'])
    : DEFAULT_MAX_STALENESS_MS;
  const verifiedIndex = verifyAndParseIndex(raw, { maxStalenessMs });
  console.log(
    `[registry-web] index OK: schemaVersion=${verifiedIndex.payload.schemaVersion} ` +
      `version=${verifiedIndex.payload.index.version} connectors=${verifiedIndex.payload.connectors.length} ` +
      `(cryptographically verified: ${verifiedIndex.verified})`
  );

  // Step 4: derive render model (throws BuildError on e.g. reserved-name collision).
  let model = buildRenderModel(verifiedIndex.payload, { verified: verifiedIndex.verified });

  // Step 5: Scarf stats, best-effort — a Scarf-fetch failure never throws past
  // fetchAllScarfStats (it degrades to `unavailable: true` per connector).
  const stats = await fetchAllScarfStats(model.connectors.map((c) => c.name));
  model = mergeScarfStats(model, stats);

  // Step 6: write generated artifacts consumed by the Astro build.
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(RENDER_MODEL_PATH, JSON.stringify(model, null, 2));
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(SEARCH_MANIFEST_PATH, JSON.stringify(model.searchManifest));
  console.log(
    `[registry-web] wrote render model (${model.connectors.length} connectors) + search manifest`
  );

  // Step 7: astro build.
  const astroResult = spawnSync('npx', ['astro', 'build'], {
    cwd: webRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (astroResult.status !== 0) {
    throw new Error(`astro build failed with exit code ${astroResult.status ?? 'unknown'}`);
  }

  // Step 8: copy index.json BYTE-FOR-BYTE into dist/ — this must NEVER be a
  // re-serialization (JSON.parse + JSON.stringify would reformat whitespace and
  // could reorder keys depending on the parser, silently invalidating the
  // detached signature, which is computed over the exact JCS-canonicalized
  // payload bytes). We write the exact same Buffer we verified above, untouched.
  const distIndexPath = path.join(DIST_DIR, 'index.json');
  writeFileSync(distIndexPath, rawBuffer);
  const writtenBack = readFileSync(distIndexPath);
  if (!writtenBack.equals(rawBuffer)) {
    throw new Error(
      'dist/index.json does not byte-match the verified source index.json — refusing to proceed'
    );
  }
  console.log(`[registry-web] dist/index.json byte-verified against ${INDEX_PATH}`);
  console.log('[registry-web] build complete.');
}

main().catch((err: unknown) => {
  if (err instanceof BuildError) {
    console.error(`[registry-web] BUILD FAILED [${err.code}]: ${err.message}`);
  } else {
    console.error('[registry-web] BUILD FAILED:', err);
  }
  process.exitCode = 1;
});
