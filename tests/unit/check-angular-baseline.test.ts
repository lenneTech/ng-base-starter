/**
 * Guards the CLI-baseline gate (`scripts/check-angular-baseline.mjs`). The gate itself needs `npx` and a fresh
 * `ng new`, so it runs as `pnpm run check:baseline` (release gate, CI, after every `ng update`); these tests pin the
 * decisions it makes on the way.
 */
import { describe, expect, it } from 'vitest';

import { ALLOWED, diffJson, judge, keyMatches, NG_NEW_ARGS, parseJsonc, satisfiesCliRange } from '../../scripts/check-angular-baseline.mjs';

describe('satisfiesCliRange', () => {
  it.each([
    ['22.2.4', '^22.2.0', true],
    ['23.0.0', '^22.2.0', false],
    ['22.1.9', '^22.2.0', false],
    ['7.8.2', '~7.8.0', true],
    ['7.9.0', '~7.8.0', false],
    ['6.0.3', '~6.0.2', true],
    ['26.6.6', '^22.12.0', false],
    ['0.4.7', '^0.4.0', true],
    ['0.5.0', '^0.4.0', false],
    ['1.2.3', '1.2.3', true],
    ['link:../x', '^1.0.0', false],
  ])('%s against %s → %s', (version, range, expected) => {
    expect(satisfiesCliRange(version, range)).toBe(expected);
  });
});

describe('keyMatches', () => {
  it('matches segments exactly, * one segment, a trailing ** everything below', () => {
    expect(keyMatches(['dependencies', '*'], ['dependencies', '@lenne.tech/ng-base'])).toBe(true);
    expect(keyMatches(['dependencies', '*'], ['dependencies', 'a', 'b'])).toBe(false);
    expect(keyMatches(['scripts', '**'], ['scripts', 'dev'])).toBe(true);
    expect(keyMatches(['name'], ['version'])).toBe(false);
  });
});

describe('diffJson', () => {
  it('reports differing, missing and extra keys, and accepts an exact pin inside the CLI range', () => {
    const reference = { dependencies: { a: '^1.0.0', b: '^1.0.0' }, name: 'app', nested: { keep: 1, x: 1 } };
    const actual = { dependencies: { a: '1.4.0', b: '2.0.0', c: '1.0.0' }, nested: { keep: 1, x: 2 }, type: 'module' };
    expect(diffJson(reference, actual)).toEqual([
      { key: ['dependencies', 'b'], kind: 'value' },
      { key: ['dependencies', 'c'], kind: 'extra' },
      { key: ['name'], kind: 'value' },
      { key: ['nested', 'x'], kind: 'value' },
      { key: ['type'], kind: 'extra' },
    ]);
  });
});

describe('parseJsonc', () => {
  it('reads the CLI tsconfigs with their comments and keeps comment-like text inside strings', () => {
    expect(parseJsonc('/* head */\n{\n  // line\n  "a": "http://x", "b": [1,],\n}')).toEqual({ a: 'http://x', b: [1] });
  });
});

describe('judge', () => {
  const allowed = [
    { kind: 'absent' as const, path: '.prettierrc', reason: 'r' },
    { key: ['scripts', '**'], kind: 'value' as const, path: 'package.json', reason: 'r' },
  ];

  it('explains listed deviations and reports the rest', () => {
    const { stale, unexplained } = judge(
      [
        { kind: 'absent', path: '.prettierrc' },
        { key: ['scripts', 'build'], kind: 'value', path: 'package.json' },
        { key: ['name'], kind: 'value', path: 'package.json' },
      ],
      allowed,
    );
    expect(unexplained).toEqual([{ key: ['name'], kind: 'value', path: 'package.json' }]);
    expect(stale).toEqual([]);
  });

  it('reports an allowance that no longer matches any deviation as stale', () => {
    expect(judge([{ kind: 'absent', path: '.prettierrc' }], allowed).stale).toEqual([allowed[1]]);
  });
});

describe('the allowlist', () => {
  it('gives every allowed deviation a reason', () => {
    for (const entry of ALLOWED) expect(entry.reason.length, `${entry.path} ${entry.key?.join('.') ?? ''}`).toBeGreaterThan(10);
  });

  it('generates the reference with the flags the starter was created with', () => {
    expect(NG_NEW_ARGS).toEqual(expect.arrayContaining(['--ssr', '--style=tailwind', '--zoneless', '--strict', '--ai-config=claude-code', '--skip-install']));
  });
});
