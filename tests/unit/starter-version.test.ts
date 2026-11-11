// @vitest-environment node
/**
 * The starter carries the version of the ng-base release it pins (CLAUDE.md, "Versioning of this template"; the Nuxt
 * template's `scripts/starter-version.test.mjs`).
 *
 * A release commit that raises the pin and forgets `version`, or the other way round, tags the starter under a number
 * that names a different ng-base release, and every migration guide and changelog link of that release points at the
 * wrong version. Until this test, only a command in CLAUDE.md to run by hand caught it.
 *
 * The test runs only in the starter's own repository, recognised by its `origin` (this checkout, the CI checkout, a
 * release worktree). A project generated from the starter has its own version and upgrades ng-base on its own schedule,
 * so the two numbers differ there by design: the lt CLI starts it at `0.0.0`, which this test would reject. Its files
 * cannot tell it apart reliably: the CLI removes CHANGELOG.md, `migration-guides/` and the starter's name, but a CLI
 * before 1.58.6 kept all of them, and this file is copied either way. What every generated project lacks is the
 * starter's `.git`. The Nuxt template keeps its test outside the copied `nuxt-base-template/` for the same reason; the
 * Angular starter is copied whole.
 *
 * A pin that is no registry version (the injected `file:` build while ng-base is developed alongside) names no release
 * yet; `scripts/check-ng-base-pin.mjs` refuses it for a release.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

/** Whether a git remote URL names the starter's own repository, over HTTPS or SSH, with or without `.git`. */
function isStarterRemote(url: string): boolean {
  return /[/:]lenneTech\/ng-base-starter(\.git)?\/?$/i.test(url.trim());
}

function originUrl(): string {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

describe('isStarterRemote', () => {
  it.each([
    'https://github.com/lenneTech/ng-base-starter.git',
    'https://github.com/lenneTech/ng-base-starter',
    'git@github.com:lenneTech/ng-base-starter.git',
    'https://github.com/lenneTech/ng-base-starter.git\n',
  ])('recognises %j', (url) => {
    expect(isStarterRemote(url)).toBe(true);
  });

  it.each([
    '',
    'https://gitlab.lenne.tech/customer/app.git',
    'https://github.com/lenneTech/ng-base-starter-fork.git',
    'https://github.com/someone/ng-base-starter.git',
    'https://github.com/lenneTech/lt-monorepo.git',
  ])('does not take %j for the starter', (url) => {
    expect(isStarterRemote(url)).toBe(false);
  });
});

describe.skipIf(!isStarterRemote(originUrl()))('version of this template', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; version: string };
  const pin = manifest.dependencies?.['@lenne.tech/ng-base'] ?? '';

  it.skipIf(!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pin))('equals the pinned @lenne.tech/ng-base version', () => {
    expect(manifest.version, `package.json version ${manifest.version} names no ng-base release; the starter pins ${pin}`).toBe(pin);
  });
});
