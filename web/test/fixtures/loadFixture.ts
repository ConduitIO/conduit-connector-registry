import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SignedIndex } from '../../src/lib/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** Loads the real frozen fixture this whole plan is grounded in
 * (`index/index.json`, itself a copy of ConduitIO/conduit's
 * `registry-index/sample-index.json`) as a fresh deep clone every call, so
 * tests can freely mutate their own copy without cross-test interference. */
export function loadSampleIndex(): SignedIndex {
  const raw = readFileSync(path.join(repoRoot, 'index', 'index.json'), 'utf-8');
  return JSON.parse(raw) as SignedIndex;
}

export function loadSampleIndexRaw(): string {
  return readFileSync(path.join(repoRoot, 'index', 'index.json'), 'utf-8');
}

/** The sample index's own timestamp — pass as `now` to verifyAndParseIndex in
 * tests so freshness checks are deterministic and don't depend on wall-clock
 * time drifting away from the fixture's fixed `index.timestamp`. */
export const SAMPLE_INDEX_TIMESTAMP = '2026-07-14T09:00:00Z';
