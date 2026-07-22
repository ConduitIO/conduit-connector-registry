import type { CSSProperties } from 'react';
import styles from './VerifiedBadge.module.css';

/**
 * Renders the result of `deriveVerified()` (src/lib/deriveVerified.ts) — this
 * component NEVER computes trust itself, it only displays a boolean its caller
 * already derived from the verified index payload.
 *
 * Deliberately NOT a red/failure badge for `verified={false}`: an unsigned
 * connector between registration and its first signed release looks different
 * from one that actively failed a check (yanked/revoked get their own loud
 * components — EffectiveStatusTag, RevocationBanner). A muted/neutral
 * "not verified" state here avoids conflating "hasn't proven trust yet" with
 * "known bad" (step6-web-ui.md §4).
 */
export function VerifiedBadge({ verified }: { verified: boolean }) {
  const tone = verified ? 'verified' : 'unverified';
  const color = verified ? '--conduit-color-status-running' : '--conduit-color-status-unknown';
  const label = verified ? 'Verified' : 'Not yet verified';
  const glyph = verified ? '✓' : '?';

  return (
    <span
      className={styles.badge}
      data-tone={tone}
      style={{ ['--badge-color']: `var(${color})` } as CSSProperties}
    >
      <span className={styles.glyph} aria-hidden="true">
        {glyph}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
