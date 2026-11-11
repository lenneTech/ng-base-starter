// @vitest-environment node
/**
 * A migration guide for a change to the starter alone is named `migration-guides/next-<topic>.md`, and it has to be
 * renamed to `<version>-<topic>.md` in the commit that raises the version for the release it ships in (CLAUDE.md,
 * "Versioning of this template"; the Nuxt template's `scripts/next-guides.test.mjs`, nuxt-base-starter #48).
 *
 * Such a change goes to `main` without a version of its own, so when its guide is written nobody knows the number
 * yet. The number comes with the next ng-base release: the commit that pins it raises `version` in package.json, and
 * the release commit after it adds the changelog section. Between those two steps `version` is ahead of the newest
 * version in CHANGELOG.md. That is the moment to rename, and this test fails while a `next-` guide is still there.
 * Outside a release both numbers are equal and `next-` guides may wait.
 *
 * `lt fullstack init` and `lt frontend angular` remove CHANGELOG.md and migration-guides/ from a generated project,
 * which has its own version; there the test has nothing to check and skips.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const GUIDES = join(ROOT, 'migration-guides');

/** The newest version in a changelog: the first `## [x.y.z]` or `### [x.y.z]` heading. */
function newestChangelogVersion(changelog: string): string | undefined {
  return /^#{2,3} \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
}

/** Guides that still wait for a number although a release is being prepared; empty outside a release. */
function guidesToRename({ changelogVersion, guides, version }: { changelogVersion: string | undefined; guides: string[]; version: string }): string[] {
  if (version === changelogVersion) {
    return [];
  }
  return guides.filter((name) => name.startsWith('next-'));
}

const isTemplateRepo = existsSync(CHANGELOG) && existsSync(GUIDES);

describe.skipIf(!isTemplateRepo)('migration guides of this template', () => {
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const changelogVersion = isTemplateRepo ? newestChangelogVersion(readFileSync(CHANGELOG, 'utf8')) : undefined;
  const guides = isTemplateRepo ? readdirSync(GUIDES).filter((name) => name.endsWith('.md')) : [];

  it('CHANGELOG.md names its newest version in the first release heading', () => {
    expect(changelogVersion ?? '', 'no `## [x.y.z]` / `### [x.y.z]` heading found in CHANGELOG.md').toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('a release being prepared has no `next-` guide left', () => {
    const pending = guidesToRename({ changelogVersion, guides, version });
    expect(
      pending,
      `package.json is at ${version}, CHANGELOG.md at ${changelogVersion}: this is a release, so rename ${pending
        .map((name) => `migration-guides/${name} to ${version}-${name.slice('next-'.length)}`)
        .join(', ')} in this commit, and link it in the release commit's changelog section`,
    ).toEqual([]);
  });
});

describe('the rule itself (self-test)', () => {
  it('lets `next-` guides wait outside a release and blocks them in one being prepared', () => {
    const sample = ['14.x-to-22.0.0.md', 'next-a.md', 'next-b.md'];
    expect(guidesToRename({ changelogVersion: '22.0.5', guides: sample, version: '22.0.5' })).toEqual([]);
    expect(guidesToRename({ changelogVersion: '22.0.5', guides: sample, version: '22.0.6' })).toEqual(['next-a.md', 'next-b.md']);
    expect(guidesToRename({ changelogVersion: '22.0.5', guides: ['22.0.6-a.md'], version: '22.0.6' })).toEqual([]);
  });

  it('reads the newest version from the first release heading', () => {
    expect(newestChangelogVersion('# Changelog\n\n### [22.0.5](x) (d)\n\n### [22.0.4](y) (d)\n')).toBe('22.0.5');
    expect(newestChangelogVersion('# Changelog\n\n## [23.0.0](x) (d)\n')).toBe('23.0.0');
  });
});
