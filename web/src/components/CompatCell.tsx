import styles from './CompatCell.module.css';

export interface CompatCellProps {
  os: string;
  arch: string;
  available: boolean;
  /** Issues URL to link a "not available" cell to, as a lightweight "request
   * this platform" affordance (step6-web-ui.md §5 item 5). Omitted entirely
   * (falls back to plain text) if the connector has no `repository` field. */
  requestUrl?: string;
}

/**
 * One cell of the OS x arch compatibility matrix. ALWAYS one of two explicit
 * states — never blank/omitted — because a blank cell is ambiguous between "no
 * data" and "unsupported," and this connector might genuinely lack a build for
 * this platform (step6-web-ui.md §5 item 5, §9 edge case).
 */
export function CompatCell({ os, arch, available, requestUrl }: CompatCellProps) {
  if (available) {
    return (
      <td className={styles.cell} data-available="true">
        <span className={styles.available}>
          <span className={styles.availableGlyph} aria-hidden="true">
            ✓
          </span>{' '}
          Available
        </span>
      </td>
    );
  }

  return (
    <td className={styles.cell} data-available="false">
      <span className={styles.unavailable}>
        <span aria-hidden="true">—</span> Not available
        {requestUrl ? (
          <>
            {' '}
            (
            <a href={requestUrl} target="_blank" rel="noopener noreferrer">
              request {os}/{arch}
            </a>
            )
          </>
        ) : null}
      </span>
    </td>
  );
}
