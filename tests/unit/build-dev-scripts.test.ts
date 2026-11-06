/**
 * Guards the two entry scripts the lt tooling relies on:
 *
 * - `scripts/build.mjs` honours `NG_OUTPUT_DIR` (default `.output`) and writes the shim
 *   `<dir>/server/index.mjs` that lt-monorepo's CI, the Dockerfile and `lt dev test` start (plan §5.6);
 * - `scripts/dev.mjs` serves on 3001 unless `PORT` says otherwise, and refuses a busy port instead of
 *   letting the Angular CLI pick another one the API does not trust (plan §8).
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveOutputDir, SHIM_SOURCE, writeServerShim } from '../../scripts/build.mjs';
import { isPortFree, probeHosts, resolveDevPort, serveArgs } from '../../scripts/dev.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe('scripts/build.mjs', () => {
  it('builds into .output by default and into NG_OUTPUT_DIR when set', () => {
    expect(resolveOutputDir({})).toBe('.output');
    expect(resolveOutputDir({ NG_OUTPUT_DIR: '  ' })).toBe('.output');
    expect(resolveOutputDir({ NG_OUTPUT_DIR: '.output-test' })).toBe('.output-test');
  });

  it('writes a shim that starts the Angular server, next to server.mjs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ngbs-build-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'server', 'server.mjs'), 'export function startServer() {}\n');

    const shim = writeServerShim(dir);

    expect(shim).toBe(join(dir, 'server', 'index.mjs'));
    expect(readFileSync(shim, 'utf8')).toBe(SHIM_SOURCE);
    expect(SHIM_SOURCE).toMatch(/import \{ startServer \} from '\.\/server\.mjs';/);
    expect(SHIM_SOURCE).toMatch(/^startServer\(\);$/m);
  });

  it('refuses to write a shim when the build produced no server entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ngbs-build-'));
    tempDirs.push(dir);
    expect(() => writeServerShim(dir)).toThrow(/server\.mjs not found/);
  });

  it('is what `build` and `build:check` run, and the check chain boots the tree it built', () => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(scripts['build']).toBe('node scripts/build.mjs');
    expect(scripts['build:check']).toBe('cross-env NG_OUTPUT_DIR=.output-check node scripts/build.mjs');
    for (const chain of ['check:raw', 'check:fix', 'check:naf']) {
      expect(scripts[chain], chain).toContain('cross-env NG_OUTPUT_DIR=.output-check node scripts/check-server-start.mjs');
    }
  });

  it('exports startServer from src/server.ts, which the shim imports', () => {
    expect(readFileSync(join(ROOT, 'src', 'server.ts'), 'utf8')).toMatch(/^export function startServer\(\)/m);
  });
});

describe('scripts/dev.mjs', () => {
  it('defaults to port 3001, the origin the API trusts', () => {
    expect(resolveDevPort({})).toBe(3001);
    expect(resolveDevPort({ PORT: 'abc' })).toBe(3001);
    expect(resolveDevPort({ PORT: '70000' })).toBe(3001);
    expect(resolveDevPort({ PORT: '4123' })).toBe(4123);
  });

  it('probes both loopback families unless a host is configured', () => {
    expect(probeHosts(undefined)).toEqual(['127.0.0.1', '::1']);
    expect(probeHosts('0.0.0.0')).toEqual(['0.0.0.0']);
  });

  it('passes the port, and the host only when one is set', () => {
    expect(serveArgs(3001, undefined).slice(0, 2)).toEqual(['serve', '--port=3001']);
    expect(serveArgs(3001, '0.0.0.0').slice(0, 3)).toEqual(['serve', '--port=3001', '--host=0.0.0.0']);
  });

  it('reports a busy port as busy and a free one as free', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      expect(await isPortFree(port, '127.0.0.1')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await isPortFree(port, '127.0.0.1')).toBe(true);
  });
});
