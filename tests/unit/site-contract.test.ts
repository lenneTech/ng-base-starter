/**
 * `lt fullstack init` (and `add-app`) rewrites the project's identity in exactly one file, `src/app/shared/site.ts`:
 * `SITE_NAME` becomes the project name, `SITE_REPO_URL` becomes `null` (which hides every GitHub link). The CLI edits
 * the two lines as text, so they stay single-line literals of exactly this form; a reformatted declaration would leave
 * "Angular Base Starter" and the starter's repository link in every generated project.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SITE = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'app', 'shared', 'site.ts'), 'utf8');

describe('src/app/shared/site.ts (the lines the CLI rewrites)', () => {
  it('declares SITE_NAME as a single-line string literal', () => {
    expect(SITE).toMatch(/^export const SITE_NAME = '[^'\n]*';$/m);
  });

  it('declares SITE_REPO_URL as a single-line string literal or null', () => {
    expect(SITE).toMatch(/^export const SITE_REPO_URL: null \| string = (?:'[^'\n]*'|null);$/m);
  });

  it('is the only place that names the starter repository', () => {
    // Links elsewhere would survive the CLI's rewrite.
    expect(SITE.match(/github\.com\/lenneTech\/ng-base-starter/g)?.length).toBe(1);
  });
});
