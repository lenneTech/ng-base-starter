import type { Route, Routes } from '@angular/router';

/** One matched route of a resolution, with its full path (parameters as `:name`, a wildcard as `:**`). */
export interface ResolvedRoute {
  path: string;
}

function join(base: string, path: string): string {
  return [base, path].filter(Boolean).join('/');
}

/** Every leaf path of a route config, full paths, `/`-prefixed, in config order. */
export function routePaths(config: Routes, base = ''): string[] {
  const out: string[] = [];
  for (const route of config) {
    const full = join(base, route.path ?? '');
    if (route.children?.length) {
      out.push(...routePaths(route.children, full));
    } else {
      out.push(`/${full}`);
    }
  }
  return out;
}

/** Match `segments` against one route (and its children); the chain of matched routes, or null. */
function matchRoute(route: Route, segments: string[], base: string): ResolvedRoute[] | null {
  const own = (route.path ?? '').split('/').filter(Boolean);
  if (route.path === '**') {
    return [{ path: `/${join(base, ':**')}` }];
  }
  if (own.length > segments.length) {
    return null;
  }
  for (const [index, part] of own.entries()) {
    if (!part.startsWith(':') && part.toLowerCase() !== segments[index]?.toLowerCase()) {
      return null;
    }
  }
  const full = join(base, own.join('/'));
  const rest = segments.slice(own.length);
  if (route.children?.length) {
    const child = resolveSegments(route.children, rest, full);
    return child ? [{ path: `/${full}` }, ...child] : null;
  }
  // A leaf matches the whole path only (Angular's default `pathMatch` for leaves with a path is a prefix, but a
  // leaf with segments left over never renders).
  return rest.length === 0 ? [{ path: `/${full}` }] : null;
}

function resolveSegments(config: Routes, segments: string[], base: string): ResolvedRoute[] | null {
  // Static routes first, as the router's own ranking does in practice for this app: a literal path before a parameter.
  const ordered = [...config].sort((a, b) => Number((a.path ?? '').includes(':') || a.path === '**') - Number((b.path ?? '').includes(':') || b.path === '**'));
  for (const route of ordered) {
    const matched = matchRoute(route, segments, base);
    if (matched) {
      return matched;
    }
  }
  return null;
}

/**
 * Resolves a path against the route config the way `analytics-url.ts`'s `staticRoutes` needs it: the chain of matched
 * routes with their full paths, or none. Lazy children (`loadChildren`) are not walked; the starter declares its
 * routes inline and loads components lazily.
 */
export function resolveRoute(config: Routes, path: string): { matched: ResolvedRoute[] } {
  const segments = path.split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
  return { matched: resolveSegments(config, segments, '') ?? [] };
}
