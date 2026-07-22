/**
 * Route segments this site's own generator uses that a connector `name` must never
 * collide with (step6-web-ui.md §9 edge-case table: "connector name collides with a
 * reserved route segment ... validate ... fail the build loudly on collision rather
 * than silently shadowing a route"). The schema's own `name` pattern
 * (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`) already rules out anything containing a
 * `/`, so a collision can only ever be an exact match against one of these segments.
 */
export const RESERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  '404',
  'page',
  'connectors',
  'index.json',
  'search-manifest.json',
]);

export function isReservedRouteSegment(name: string): boolean {
  return RESERVED_ROUTE_SEGMENTS.has(name.toLowerCase());
}
