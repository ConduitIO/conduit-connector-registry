export const CONNECTORS_PER_PAGE = 60;

export function paginate<T>(items: readonly T[], pageSize: number = CONNECTORS_PER_PAGE): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}
