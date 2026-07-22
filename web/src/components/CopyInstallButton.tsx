import { useState } from 'react';
import styles from './CopyInstallButton.module.css';

/**
 * One of two client islands on the site (the other is SearchBox). Renders the
 * `<pre><code>` server-side-equivalent markup plus a hydrated copy button —
 * with JS disabled, the command is still fully visible and selectable text,
 * just without the one-click copy affordance (step6-web-ui.md §5 item 3, §7).
 *
 * No version pin in the command (omitting `@version` matches the CLI's own
 * "newest compatible" resolution philosophy) — the caller is responsible for
 * never rendering this component at all when `suppressInstallCommand` is true
 * (revoked publisher / all-versions-yanked), per step6-web-ui.md §5 item 2/3.
 */
export function CopyInstallButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions);
      // the command text remains selectable in the <pre> either way, so this
      // is a degraded-but-not-broken failure — no error UI needed.
    }
  }

  return (
    <div className={styles.wrapper}>
      <pre className={styles.code}>
        <code>{command}</code>
      </pre>
      <button type="button" className={styles.button} onClick={() => void handleCopy()}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <span role="status" aria-live="polite" className="visually-hidden">
        {copied ? 'Install command copied to clipboard' : ''}
      </span>
    </div>
  );
}
