/**
 * `lt fullstack init` (and `add-app`) rewrites the project's identity in exactly one file, `src/app/shared/site.ts`:
 * `SITE_NAME` becomes the project name, `SITE_REPO_URL` becomes `null` (which hides every GitHub link). The CLI edits
 * the two lines as text, so they stay single-line literals of exactly this form; a reformatted declaration would leave
 * "Angular Base Starter" and the starter's repository link in every generated project.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const SITE_FILE = join(SRC, 'app', 'shared', 'site.ts');
const SITE = readFileSync(SITE_FILE, 'utf8');

describe('src/app/shared/site.ts (the lines the CLI rewrites)', () => {
  it('declares SITE_NAME as a single-line string literal', () => {
    expect(SITE).toMatch(/^export const SITE_NAME = '[^'\n]*';$/m);
  });

  it('declares SITE_REPO_URL as a single-line string literal or null', () => {
    expect(SITE).toMatch(/^export const SITE_REPO_URL: null \| string = (?:'[^'\n]*'|null);$/m);
  });

  it('is the only place under src/ that names the starter repository', () => {
    // A link anywhere else would survive the CLI's rewrite. In a generated project site.ts no longer names it either.
    const others = readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:html|ts)$/.test(entry.name) && join(entry.parentPath, entry.name) !== SITE_FILE)
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => readFileSync(file, 'utf8').includes('github.com/lenneTech/ng-base-starter'));
    expect(others.map((file) => relative(SRC, file))).toEqual([]);
  });
});
