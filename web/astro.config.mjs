import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static output only — no server adapter. The registry site is a build-time-generated
// artifact deployed to GitHub Pages; there is no backend and no SSR at request time
// (registry-plan-v2.md §7, step6 "generated from the index, no backend").
//
// React is wired via @astrojs/react but used ONLY for the two islands that need client
// JS (search box, copy-install-command button) — every other component renders to plain
// HTML with zero hydration. See src/components/*.tsx for which ones carry a client:*
// directive in the pages that use them.
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL ?? 'https://registry.conduit.io',
  integrations: [react()],
  build: {
    format: 'directory',
  },
});
