import { describe, expect, it } from 'vitest';
import { mergeScarfStats, unavailableStats } from '../src/lib/scarfStats';
import { buildRenderModel } from '../src/lib/renderModel';
import { loadSampleIndex } from './fixtures/loadFixture';

describe('mergeScarfStats — Scarf-fault-injection (§9 edge case: never fails the build)', () => {
  it('merges an "unavailable" stats entry without touching any other connector field', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const statsByName = new Map(
      model.connectors.map((c) => [c.name, unavailableStats('2026-07-22T00:00:00Z')])
    );

    const merged = mergeScarfStats(model, statsByName);
    for (const c of merged.connectors) {
      expect(c.stats?.unavailable).toBe(true);
      expect(c.stats?.totalDownloads).toBeUndefined();
    }
    // Nothing else in the model changed.
    expect(merged.connectors.map((c) => c.name)).toEqual(model.connectors.map((c) => c.name));
  });

  it('never renders a bare 0 for unavailable stats — the type itself has no numeric default', () => {
    const stats = unavailableStats('2026-07-22T00:00:00Z');
    expect(stats.unavailable).toBe(true);
    expect(stats.totalDownloads).toBeUndefined();
  });

  it('leaves connectors with no stats entry entirely untouched (partial-outage case)', () => {
    const { payload } = loadSampleIndex();
    const model = buildRenderModel(payload);
    const empty = new Map<string, ReturnType<typeof unavailableStats>>();
    const merged = mergeScarfStats(model, empty);
    expect(merged.connectors.every((c) => c.stats === undefined)).toBe(true);
  });
});
