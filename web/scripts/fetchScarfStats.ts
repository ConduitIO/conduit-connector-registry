import type { ConnectorStats } from '../src/lib/renderModel';
import { unavailableStats } from '../src/lib/scarfStats';

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Best-effort Scarf download-stats fetch (step6-web-ui.md §3 step 6). This is a
 * DIFFERENT failure bucket from index-integrity checks: stats are
 * presentation-only, never a trust input, so a Scarf outage — or simply no API
 * token configured yet, which is the honest state of this scaffold today —
 * degrades gracefully to an explicit "unavailable" per-connector state and MUST
 * NOT fail the build (step6-web-ui.md §9 edge case).
 *
 * TODO(follow-up): Scarf's actual stats API endpoint/auth shape isn't wired in
 * yet — this fetches a placeholder URL shape and will currently always fall
 * back to "unavailable" until Scarf API access is provisioned (a named,
 * flagged gap, not a silent one; see registry-plan-v2.md §12 decision 5 on the
 * related Scarf-fallback timing question).
 */
export async function fetchAllScarfStats(
  connectorNames: readonly string[]
): Promise<Map<string, ConnectorStats>> {
  const asOf = new Date().toISOString();
  const result = new Map<string, ConnectorStats>();

  const token = process.env['SCARF_API_TOKEN'];
  if (!token) {
    console.warn(
      '[registry-web] SCARF_API_TOKEN not set — all connector stats will show "unavailable".'
    );
    for (const name of connectorNames) result.set(name, unavailableStats(asOf));
    return result;
  }

  await Promise.all(
    connectorNames.map(async (name) => {
      result.set(name, await fetchOneWithRetry(name, token, asOf));
    })
  );
  return result;
}

async function fetchOneWithRetry(
  name: string,
  token: string,
  asOf: string
): Promise<ConnectorStats> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchOne(name, token, asOf);
    } catch (err) {
      if (attempt === 1) {
        console.warn(
          `[registry-web] Scarf stats fetch failed for "${name}" after retry: ${(err as Error).message}`
        );
      }
    }
  }
  return unavailableStats(asOf);
}

async function fetchOne(name: string, token: string, asOf: string): Promise<ConnectorStats> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.scarf.sh/v2/packages/conduitio/conduit-connector-${name}/downloads`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { total?: number };
    return { unavailable: false, totalDownloads: body.total ?? 0, asOf };
  } finally {
    clearTimeout(timeout);
  }
}
