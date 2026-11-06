/**
 * Where the built server (`node .output/server/index.mjs`) listens: `PORT` and `HOST` from the environment.
 *
 * Without `PORT` it takes 3001, the app port of the backend contract (API 3000, app 3001), so a local run of the build
 * never collides with the API. The production image sets `PORT=3000` and `HOST=0.0.0.0` itself (Dockerfile; compose
 * maps host 3001 to container 3000). Without `HOST` Node listens on every interface.
 */
export function resolveListenAddress(env: Readonly<Record<string, string | undefined>>): { host: string | undefined; port: number } {
  const port = Number.parseInt(env['PORT'] ?? '', 10);
  const host = env['HOST']?.trim();
  return { host: host || undefined, port: Number.isInteger(port) && port > 0 ? port : 3001 };
}
