import { useEffect, useMemo, useState } from 'react';
import styles from './SearchBox.module.css';
import { EffectiveStatusTag } from './EffectiveStatusTag';
import type { SearchManifestEntry } from '../lib/renderModel';

/**
 * The one non-trivial island (step6-web-ui.md §5 "Search"). Deliberately the
 * simplest thing that passes the AC, per this repo's YAGNI stance — plain
 * case-insensitive substring matching across name/displayName/description, not
 * a fuzzy-search library. Upgrade only if real usage at real connector-count
 * scale shows it's insufficient (the count is expected to stay in the
 * dozens-to-low-hundreds range, never a fuzzing-scale catalog).
 *
 * Operates over the FULL manifest (fetched from /search-manifest.json, covering
 * every connector across every paginated page), not just the connectors present
 * in this page's server-rendered HTML — so search results are never limited by
 * which page you happened to load. Behavior:
 *
 *   - Query empty: the original server-rendered, paginated `<ul>` (passed in via
 *     `listContainerId`) stays fully visible exactly as rendered — the "full
 *     current page's list always in the markup" property holds, unaffected by
 *     this island ever mounting.
 *   - Query non-empty: the server-rendered list for THIS page is hidden (so we
 *     don't show two overlapping/contradictory lists) and this component
 *     renders its own client-side result list built from the full manifest,
 *     which is not restricted to the current page.
 *
 * With JS disabled, this component doesn't hydrate at all — the input is simply
 * absent, and the always-present paginated static list plus the browser's own
 * find-in-page cover discovery (step6-web-ui.md §5).
 */
export function SearchBox({ listContainerId }: { listContainerId: string }) {
  const [manifest, setManifest] = useState<SearchManifestEntry[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/search-manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error(`search manifest fetch failed: ${res.status}`);
        return res.json() as Promise<SearchManifestEntry[]>;
      })
      .then((data) => {
        if (!cancelled) setManifest(data);
      })
      .catch(() => {
        // Search degrades to "absent" if the manifest can't be fetched — the
        // static paginated list underneath is unaffected either way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const listEl = document.getElementById(listContainerId);
    if (!listEl) return;
    listEl.style.display = query.trim() ? 'none' : '';
  }, [query, listContainerId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !manifest) return [];
    return manifest.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [query, manifest]);

  const showResults = query.trim().length > 0;

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="connector-search">
        Search connectors
      </label>
      <input
        id="connector-search"
        type="search"
        className={styles.input}
        placeholder="postgres, kafka, s3..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p role="status" aria-live="polite" className="visually-hidden">
        {showResults
          ? `${results.length} matching connector${results.length === 1 ? '' : 's'}`
          : ''}
      </p>
      {showResults ? (
        <ul className={styles.results}>
          {results.map((c) => (
            <li key={c.name} className={styles.resultItem}>
              <a href={`/connectors/${c.name}/`}>{c.displayName}</a>{' '}
              <EffectiveStatusTag status={c.effectiveStatus} />
              <p className={styles.resultDescription}>{c.description}</p>
            </li>
          ))}
          {results.length === 0 ? (
            <li className={styles.resultItem}>No connectors match &ldquo;{query}&rdquo;.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
