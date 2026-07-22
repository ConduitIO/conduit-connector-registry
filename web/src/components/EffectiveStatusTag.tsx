import type { CSSProperties } from 'react';
import type { EffectiveStatus } from '../lib/effectiveStatus';
import styles from './EffectiveStatusTag.module.css';

const TONE_BY_STATUS: Record<
  Exclude<EffectiveStatus, 'active'>,
  { color: string; glyph: string; label: string }
> = {
  deprecated: { color: '--conduit-color-status-recovering', glyph: '◐', label: 'Deprecated' },
  yanked: { color: '--conduit-color-status-degraded', glyph: '▲', label: 'All versions yanked' },
  revoked: { color: '--conduit-color-status-degraded', glyph: '▲', label: 'Revoked' },
};

/**
 * Connector-level effective-status tag (step6-web-ui.md §5 item 1). Renders
 * nothing for "active" — only shown when there's something to flag, per the
 * page spec ("`effectiveStatus` tag if not active"). Deprecated is intentionally
 * a distinct (amber) tone from yanked/revoked (red): it's a maintenance signal,
 * not a trust failure — never conflate the two colors.
 */
export function EffectiveStatusTag({ status }: { status: EffectiveStatus }) {
  if (status === 'active') return null;

  const tone = TONE_BY_STATUS[status];
  return (
    <span
      className={styles.tag}
      data-status={status}
      style={{ ['--tag-color']: `var(${tone.color})` } as CSSProperties}
    >
      <span className={styles.glyph} aria-hidden="true">
        {tone.glyph}
      </span>
      <span className={styles.label}>{tone.label}</span>
    </span>
  );
}
