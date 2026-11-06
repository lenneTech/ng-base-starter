/** Typed surface of `scripts/dev.mjs` (the pure helpers its unit test imports). */

/** The dev port: `PORT` when it is a valid port number, otherwise 3001. */
export function resolveDevPort(env?: Record<string, string | undefined>): number;

/** Resolves true when `port` can be bound on `host`. */
export function isPortFree(port: number, host?: string): Promise<boolean>;

/** The hosts to probe for a configured host, or both loopback families. */
export function probeHosts(host?: string): string[];

/** The `ng serve` arguments for a port and an optional host. */
export function serveArgs(port: number, host?: string): string[];
