#!/usr/bin/env tsx
/**
 * Automated a11y gate (step6-web-ui.md §3 step 8, §7): runs axe-core, in a real
 * headless browser (Playwright/Chromium), against the LIST page and one
 * connector detail page per status variant (active/verified, deprecated,
 * yanked, revoked). Zero critical/serious violations gates the deploy — CI
 * treats a non-zero exit from this script as a failed build (see
 * .github/workflows/ci.yml).
 *
 * A real browser (not jsdom) is used deliberately: axe-core's `color-contrast`
 * rule and several other checks depend on actual layout/paint, which jsdom
 * cannot provide reliably. Running against real Chromium means every axe-core
 * rule in the wcag2a/wcag2aa rulesets executes for real, including contrast —
 * no rule is disabled here. (test/contrastTokens.test.ts additionally verifies
 * the same token pairings deterministically and fast, without a browser, as a
 * belt-and-suspenders check that doesn't depend on a built dist/ existing.)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import type { RenderModel } from '../src/lib/renderModel';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const distDir = path.join(webRoot, 'dist');
const renderModelPath = path.join(webRoot, '.generated', 'render-model.json');
const AXE_CORE_PATH = path.join(webRoot, 'node_modules', 'axe-core', 'axe.min.js');

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { html: string }[];
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

/** Minimal static file server for `dist/` — Astro's `build.format: 'directory'`
 * means routes like `/connectors/postgres/` map to `connectors/postgres/index.html`
 * on disk, so directory requests need an index.html fallback. No new
 * dependency (e.g. `serve`/`sirv`) for something this small. */
function startStaticServer(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (reqPath.endsWith('/')) reqPath += 'index.html';
    let filePath = path.join(root, reqPath);
    if (!existsSync(filePath) && existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
    if (!existsSync(filePath)) {
      const notFound = path.join(root, '404.html');
      res.writeHead(existsSync(notFound) ? 404 : 404, {
        'Content-Type': 'text/html; charset=utf-8',
      });
      res.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function representativeConnectorRoutes(): string[] {
  if (!existsSync(renderModelPath)) {
    throw new Error(`render model not found at ${renderModelPath} — run \`npm run build\` first`);
  }
  const model = JSON.parse(readFileSync(renderModelPath, 'utf-8')) as RenderModel;
  const byStatus = new Map<string, string>();
  for (const c of model.connectors) {
    if (!byStatus.has(c.effectiveStatus)) byStatus.set(c.effectiveStatus, c.name);
  }
  return [...byStatus.values()].map((name) => `/connectors/${name}/`);
}

async function main(): Promise<void> {
  if (!existsSync(distDir)) {
    throw new Error(`${distDir} not found — run \`npm run build\` before the a11y scan`);
  }
  if (!existsSync(AXE_CORE_PATH)) {
    throw new Error(`axe-core browser bundle not found at ${AXE_CORE_PATH}`);
  }

  const routes = ['/', ...representativeConnectorRoutes()];
  const server = await startStaticServer(distDir);
  const browser = await chromium.launch();

  let totalViolations = 0;
  try {
    const page = await browser.newPage();
    await page.addInitScript({ path: AXE_CORE_PATH });

    for (const route of routes) {
      const url = new URL(route, server.url).toString();
      await page.goto(url, { waitUntil: 'load' });
      const results = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: { run: (opts: unknown) => Promise<{ violations: unknown[] }> };
          }
        ).axe;
        return axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      });
      const violations = results.violations as AxeViolation[];
      const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

      if (blocking.length > 0) {
        console.error(`[axe-scan] ${blocking.length} critical/serious violation(s) on ${route}:`);
        for (const v of blocking) {
          console.error(`  - [${v.impact}] ${v.id}: ${v.help}`);
          for (const node of v.nodes.slice(0, 3)) console.error(`      ${node.html}`);
        }
        totalViolations += blocking.length;
      } else {
        console.log(`[axe-scan] OK (0 critical/serious): ${route}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (totalViolations > 0) {
    console.error(`[axe-scan] FAILED: ${totalViolations} critical/serious violation(s) total.`);
    process.exitCode = 1;
  } else {
    console.log('[axe-scan] PASSED: zero critical/serious violations across all scanned pages.');
  }
}

main().catch((err: unknown) => {
  console.error('[axe-scan] error running scan:', err);
  process.exitCode = 1;
});
