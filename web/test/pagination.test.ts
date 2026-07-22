import { describe, expect, it } from 'vitest';
import { paginate, CONNECTORS_PER_PAGE } from '../src/lib/pagination';

describe('paginate', () => {
  it('returns a single (empty) page for zero items', () => {
    expect(paginate([])).toEqual([[]]);
  });

  it('returns a single page when under the threshold', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(paginate(items)).toEqual([items]);
  });

  it('splits into multiple real pages once above the threshold (default 60/page)', () => {
    const items = Array.from({ length: CONNECTORS_PER_PAGE + 5 }, (_, i) => i);
    const pages = paginate(items);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(CONNECTORS_PER_PAGE);
    expect(pages[1]).toHaveLength(5);
  });
});
