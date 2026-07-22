import { describe, expect, it } from 'vitest';
import { hexToRgb, contrastRatio, compositeOver } from '../src/lib/contrast';

/**
 * Deterministic, automated contrast check (step6-web-ui.md §7: "verify every
 * token color pairing actually used ... meets 4.5:1 for text ... spot-checked
 * with an automated contrast tool, not eyeballed"). Runs in CI without a real
 * browser — see scripts/axe-scan.ts's file header for why axe-core's own
 * `color-contrast` rule is disabled there and this test is its substitute.
 *
 * These are literal copies of tokens.css's values, not an import of the CSS
 * file — CSS custom properties aren't statically readable from plain
 * TypeScript without a browser/PostCSS parse step, and duplicating six hex
 * strings here is far simpler than adding a CSS parser dependency for it. If
 * tokens.css's values ever change, this test's constants must be updated in
 * the same PR (a comment at each site would be brittle; the real guard is
 * the token-drift-check workflow catching tokens.css changes at all).
 */
const TOKENS = {
  light: { bg: '#ffffff', surface: '#f7f8fa', text: '#1a1d21' },
  dark: { bg: '#14171b', surface: '#1c2026', text: '#e6e9ee' },
};

const STATUS_COLORS = {
  verified: '#1f9d55', // --conduit-color-status-running
  degraded: '#d64545', // --conduit-color-status-degraded (revoked/yanked)
  deprecated: '#d99e00', // --conduit-color-status-recovering
  unverified: '#8a93a0', // --conduit-color-status-unknown
};

const BADGE_TINT_ALPHA = 0.12; // matches VerifiedBadge/EffectiveStatusTag .module.css

describe('badge/tag label contrast — neutral text on a status-tinted background', () => {
  for (const [theme, palette] of Object.entries(TOKENS)) {
    for (const [statusName, hex] of Object.entries(STATUS_COLORS)) {
      for (const bgName of ['bg', 'surface'] as const) {
        it(`${statusName} label text meets 4.5:1 on ${theme}/${bgName}`, () => {
          const textRgb = hexToRgb(palette.text);
          const tintRgb = hexToRgb(hex);
          const bgRgb = hexToRgb(palette[bgName]);
          const composited = compositeOver(tintRgb, BADGE_TINT_ALPHA, bgRgb);
          const ratio = contrastRatio(textRgb, composited);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe('revocation banner border/glyph contrast — non-text UI component, 3:1 minimum', () => {
  it('degraded (revoked/yanked banner) border meets 3:1 against both bg and surface, both themes', () => {
    for (const palette of Object.values(TOKENS)) {
      const borderRgb = hexToRgb(STATUS_COLORS.degraded);
      for (const bgName of ['bg', 'surface'] as const) {
        const ratio = contrastRatio(borderRgb, hexToRgb(palette[bgName]));
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
