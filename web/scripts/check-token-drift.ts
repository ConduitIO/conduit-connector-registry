#!/usr/bin/env tsx
/**
 * Drift DETECTION, not drift prevention (step6-web-ui.md §6) — there is no
 * shared npm package making divergence structurally impossible (deliberate:
 * "tokens + duplicated primitives, not a package," per the built-in-UI doc).
 * This script fetches conduit-ui's tokens.css raw from GitHub and diffs it
 * byte-for-byte against this repo's copy. Run on a schedule by
 * .github/workflows/token-drift.yml, which opens an issue on divergence.
 *
 * Exit code 0 = identical. Exit code 1 = diverged (workflow interprets this as
 * "open/update an issue"). This script itself never opens the issue — that's
 * the workflow's job via `gh issue create`, keeping this script pure/testable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');

const CONDUIT_UI_TOKENS_URL =
  process.env['CONDUIT_UI_TOKENS_URL'] ??
  'https://raw.githubusercontent.com/ConduitIO/conduit-ui/main/src/tokens/tokens.css';

async function main(): Promise<void> {
  const localPath = path.join(webRoot, 'src', 'styles', 'tokens.css');
  const local = readFileSync(localPath, 'utf-8');

  console.log(`[token-drift] fetching ${CONDUIT_UI_TOKENS_URL}`);
  const res = await fetch(CONDUIT_UI_TOKENS_URL);
  if (!res.ok) {
    throw new Error(`failed to fetch conduit-ui's tokens.css: HTTP ${res.status}`);
  }
  const upstream = await res.text();

  if (upstream === local) {
    console.log('[token-drift] identical — no drift.');
    return;
  }

  console.error("[token-drift] DIVERGED: this repo's tokens.css no longer matches conduit-ui's.");
  console.error(
    '[token-drift] reconcile manually (copy verbatim again, or document an intentional'
  );
  console.error('[token-drift] ahead/behind reason) — see step6-web-ui.md §6.');
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[token-drift] error checking drift:', err);
  process.exitCode = 1;
});
