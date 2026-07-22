import type { ConnectorStats, RenderModel } from './renderModel';

/**
 * Pure merge of best-effort Scarf download stats into an already-built render
 * model. Kept separate from the network-touching fetch (scripts/fetch-scarf-stats.mjs)
 * so the merge behavior itself — never let a stats fault touch anything else in the
 * model, never surface a bare 0 for "unavailable" — is unit-testable without a
 * network mock (step6-web-ui.md §3 step 6, §9 edge case: "Scarf down -> graceful").
 */
export function mergeScarfStats(
  model: RenderModel,
  statsByName: ReadonlyMap<string, ConnectorStats>
): RenderModel {
  return {
    ...model,
    connectors: model.connectors.map((c) => {
      const stats = statsByName.get(c.name);
      return stats ? { ...c, stats } : c;
    }),
  };
}

/** The explicit "unavailable" stats value — never a bare 0, which would read as
 * "nobody uses this" (false signal, per step6-web-ui.md §5 item 6). */
export function unavailableStats(asOf: string): ConnectorStats {
  return { unavailable: true, asOf };
}
