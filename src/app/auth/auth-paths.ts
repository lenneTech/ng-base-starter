/**
 * The auth pages a 401 never redirects away from (the interceptor's public paths, as in the Nuxt template's
 * `ltExtensions.auth.interceptor.publicPaths`): a failed request on these pages is part of the flow, not an expired
 * session.
 */
export const AUTH_PUBLIC_PATHS: readonly string[] = Object.freeze(['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/setup']);
