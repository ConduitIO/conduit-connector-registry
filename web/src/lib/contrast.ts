/** WCAG 2.1 relative-luminance + contrast-ratio math, used only by
 * test/contrastTokens.test.ts to verify token color pairings meet 4.5:1 for
 * text — an automated, deterministic stand-in for "spot-checked with an
 * automated contrast tool" (step6-web-ui.md §7) that doesn't require a real
 * browser (see scripts/axe-scan.ts's file header for why `color-contrast` is
 * disabled there). */

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Alpha-composites `fg` over `bg` at the given alpha (0-1) — approximates
 * what `color-mix(in srgb, <fg> <alpha*100>%, transparent)` renders as once
 * painted over an opaque page background, which is what the badge/tag
 * components' tinted backgrounds actually are. */
export function compositeOver(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as unknown as RGB;
}
