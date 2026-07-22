import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RenderModel } from './renderModel';

/**
 * Where scripts/build-site.ts writes the derived render model before invoking
 * `astro build`. Astro page frontmatter runs in Node at build time, so pages read
 * this file directly rather than re-deriving it — "computing every derived field
 * once, in one place" (step6-web-ui.md §3 step 5) means once per build, not once
 * per page.
 *
 * Resolved against `process.cwd()`, NOT `import.meta.url` — Astro's build
 * bundles this module into `dist/.prerender/chunks/*.mjs` before executing
 * page frontmatter, so a path computed relative to the module's own file
 * location resolves against that relocated bundle path, not the project
 * root, and silently points at a nonexistent file. `scripts/build-site.ts`
 * always spawns `astro build` with `cwd` set to the web/ project root, so
 * `process.cwd()` is stable across the bundling step.
 */
export const RENDER_MODEL_PATH = path.resolve(process.cwd(), '.generated/render-model.json');

let cached: RenderModel | undefined;

/** Astro re-evaluates page frontmatter per route during a static build, so this
 * is memoized for the life of the build process — reading + JSON.parse-ing the
 * same file once per page would be wasteful for a catalog with hundreds of
 * connectors and dozens of pages. */
export function loadRenderModel(): RenderModel {
  if (!cached) {
    const raw = readFileSync(RENDER_MODEL_PATH, 'utf-8');
    cached = JSON.parse(raw) as RenderModel;
  }
  return cached;
}
