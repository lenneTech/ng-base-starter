// nest-server users carry roles as an array (`roles: string[]`); some Better
// Auth setups additionally expose a singular `role`. Accept either so the admin
// gate stays consistent across middleware, layout nav, and per-page checks.
// LtUser only declares `role` — `roles` comes from the nest-server projection.
export type IsAdminUserCandidate = { role?: string; roles?: string[] } | null | undefined;

export function isAdminUser(user: IsAdminUserCandidate): boolean {
  return !!user?.roles?.includes('admin') || user?.role === 'admin';
}
