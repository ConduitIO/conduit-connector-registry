import type { CSSProperties } from 'react';
import styles from './RevocationBanner.module.css';

export interface RevocationBannerProps {
  /** `revoked` = publisher-revoked, the highest-severity state (role="alert",
   * assertive). `yanked` = every published version yanked, a step down in
   * severity (role="status", polite) — both suppress the install-command block,
   * but a screen-reader user should hear the difference (step6-web-ui.md §5
   * item 2, §7). */
  severity: 'revoked' | 'yanked';
  reason: string;
}

/**
 * Page-wide banner for the two states that suppress the install-command
 * copy-block. Never rendered for "deprecated" (orthogonal, not a trust/lifecycle
 * emergency) or for a subset of yanked versions (that's the per-row treatment in
 * the version table, not a page banner).
 */
export function RevocationBanner({ severity, reason }: RevocationBannerProps) {
  const isRevoked = severity === 'revoked';
  const color = '--conduit-color-status-degraded';
  const title = isRevoked ? 'Publisher revoked' : 'All versions yanked';

  return (
    <div
      className={styles.banner}
      data-severity={severity}
      role={isRevoked ? 'alert' : 'status'}
      aria-live={isRevoked ? 'assertive' : 'polite'}
      style={{ ['--banner-color']: `var(${color})` } as CSSProperties}
    >
      <span className={styles.glyph} aria-hidden="true">
        ▲
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <p className={styles.reason}>{reason}</p>
      </div>
    </div>
  );
}
