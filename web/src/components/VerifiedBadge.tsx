import type { CSSProperties } from 'react';
import styles from './VerifiedBadge.module.css';

/**
 * Renders the result of `deriveVerified()` (src/lib/deriveVerified.ts) — this
 * component NEVER computes trust itself, it only displays a boolean its caller
 * already derived from the verified index payload.
 *
 * Label wording is deliberately narrow: `deriveVerified()` only confirms that
 * this version's entry in the signed index *references* a signature bundle and
 * an SLSA provenance bundle (plus isn't yanked/revoked) — nobody in this build
 * pipeline downloads the artifact or runs `cosign verify` against it (see
 * deriveVerified.ts's doc comment for the full two-layer trust argument and its
 * residual risk, and verifyIndex.ts for why the index's own root signature check
 * is currently stubbed). "Signature on file" says exactly that much and no more.
 * Real cryptographic verification of the actual bytes happens at install time
 * (`conduit connectors install`), not here — see SignatureNote.astro, which
 * every page rendering this badge must also render so that caveat is real,
 * visible page text next to the badge, not a tooltip (CLAUDE.md: "say what was
 * actually verified").
 *
 * Deliberately NOT a red/failure badge for `verified={false}`: a connector
 * between registration and its first signed release looks different from one
 * that actively failed a check (yanked/revoked get their own loud components —
 * EffectiveStatusTag, RevocationBanner). A muted/neutral state here avoids
 * conflating "no signature reference yet" with "known bad."
 */
export function VerifiedBadge({
  verified,
  descriptionId,
}: {
  verified: boolean;
  /** id of the page's `SignatureNote` paragraph (see SignatureNote.astro), wired
   * via `aria-describedby` so a screen-reader user who lands directly on this
   * badge — not just one who reads the page top-to-bottom — still gets the
   * "what this does/doesn't mean" caveat. Optional only so unit tests can render
   * the badge in isolation without a matching note element in the DOM. */
  descriptionId?: string;
}) {
  const tone = verified ? 'signed' : 'unsigned';
  const color = verified ? '--conduit-color-status-running' : '--conduit-color-status-unknown';
  const label = verified ? 'Signature on file' : 'No signature on file';
  const glyph = verified ? '✓' : '–';

  return (
    <span
      className={styles.badge}
      data-tone={tone}
      style={{ ['--badge-color']: `var(${color})` } as CSSProperties}
      {...(descriptionId ? { 'aria-describedby': descriptionId } : {})}
    >
      <span className={styles.glyph} aria-hidden="true">
        {glyph}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
