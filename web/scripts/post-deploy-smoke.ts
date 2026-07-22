#!/usr/bin/env tsx
/**
 * Post-deploy smoke check (step6-web-ui.md §3 step 10, §9 edge case: "CDN/Pages
 * serving a stale cached index.json after deploy"). Run by the deploy workflow
 * AFTER the GitHub Pages deploy step completes. Two assertions:
 *
 *   1. The live list page contains an expected connector name string (proves
 *      the deploy actually served fresh content, not a 404/blank page).
 *   2. The deployed /index.json is BYTE-IDENTICAL to the index.json this build
 *      produced (dist/index.json) — catches a broken deploy or a CDN serving a
 *      stale cached copy, which a "does it parse as JSON" check would miss.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');

async function main(): Promise<void> {
  const siteUrl = process.env['SITE_URL'];
  if (!siteUrl) {
    throw new Error('SITE_URL env var is required (e.g. https://registry.conduit.io)');
  }

  const distIndexPath = path.join(webRoot, 'dist', 'index.json');
  if (!existsSync(distIndexPath)) {
    throw new Error(`${distIndexPath} not found — run \`npm run build\` before the smoke check`);
  }
  const builtIndexBytes = readFileSync(distIndexPath);

  console.log(`[smoke] fetching ${siteUrl}/`);
  const listRes = await fetch(new URL('/', siteUrl));
  if (!listRes.ok) throw new Error(`list page fetch failed: HTTP ${listRes.status}`);
  const listHtml = await listRes.text();
  if (!listHtml.includes('Connectors')) {
    throw new Error('list page did not contain expected marker string "Connectors"');
  }
  console.log('[smoke] list page OK');

  console.log(`[smoke] fetching ${siteUrl}/index.json`);
  const indexRes = await fetch(new URL('/index.json', siteUrl));
  if (!indexRes.ok) throw new Error(`/index.json fetch failed: HTTP ${indexRes.status}`);
  const liveIndexBytes = Buffer.from(await indexRes.arrayBuffer());

  if (!liveIndexBytes.equals(builtIndexBytes)) {
    throw new Error(
      `deployed /index.json (${liveIndexBytes.length} bytes) does NOT byte-match the build's ` +
        `verified dist/index.json (${builtIndexBytes.length} bytes) — possible stale CDN cache or broken deploy`
    );
  }
  console.log('[smoke] /index.json byte-matches the verified build output. PASSED.');
}

main().catch((err: unknown) => {
  console.error('[smoke] FAILED:', err);
  process.exitCode = 1;
});
