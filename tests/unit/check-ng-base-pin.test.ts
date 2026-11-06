/**
 * The release guard for `@lenne.tech/ng-base` (scripts/check-ng-base-pin.mjs): a released starter pins ng-base exactly
 * from the registry; the local `file:` + `injected` setup of the development phase must never reach a release.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isStrict, ngBasePinProblems } from '../../scripts/check-ng-base-pin.mjs';

describe('ngBasePinProblems', () => {
  it('accepts an exact registry version', () => {
    expect(ngBasePinProblems({ dependencies: { '@lenne.tech/ng-base': '22.0.0' } })).toEqual([]);
    expect(ngBasePinProblems({ dependencies: { '@lenne.tech/ng-base': '22.1.0-rc.1' } })).toEqual([]);
  });

  it.each(['file:../ng-base/dist/ng-base', 'link:../ng-base/dist/ng-base', 'workspace:*', '^22.0.0', '~22.0.0', 'latest'])('refuses "%s"', (spec) => {
    expect(ngBasePinProblems({ dependencies: { '@lenne.tech/ng-base': spec } })).toHaveLength(1);
  });

  it('refuses the injected development setup and a missing dependency', () => {
    expect(ngBasePinProblems({ dependencies: { '@lenne.tech/ng-base': '22.0.0' }, dependenciesMeta: { '@lenne.tech/ng-base': { injected: true } } })).toHaveLength(1);
    expect(ngBasePinProblems({ dependencies: {} })).toHaveLength(1);
  });
});

describe('vendor mode', () => {
  it('passes without a dependency, and refuses a dependency next to the vendored core', () => {
    expect(ngBasePinProblems({ dependencies: {} }, { vendored: true })).toEqual([]);
    expect(ngBasePinProblems({ dependencies: { '@lenne.tech/ng-base': '22.0.0' } }, { vendored: true })).toHaveLength(1);
  });
});

describe('isStrict', () => {
  it('is strict for a release, in CI and on request, lenient otherwise', () => {
    expect(isStrict({ LT_RELEASE: 'true' }, [])).toBe(true);
    expect(isStrict({ CI: 'true' }, [])).toBe(true);
    expect(isStrict({}, ['--strict'])).toBe(true);
    expect(isStrict({}, [])).toBe(false);
  });
});

describe('wiring', () => {
  it('runs in every check chain, and check:release runs it strictly', () => {
    const { scripts } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const chain of ['check:raw', 'check:fix', 'check:naf']) expect(scripts[chain], chain).toContain('node scripts/check-ng-base-pin.mjs');
    expect(scripts['check:release']).toContain('LT_RELEASE=true');
    expect(scripts['check:release']).toContain('check:baseline');
  });
});
