import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The auth pages of the app, read as text: `<name>-page.ts` plus its `.html`, comments stripped. */
export const AUTH_DIR = join(import.meta.dirname, '..', '..', '..', 'src', 'app', 'auth');

export function authPages(): string[] {
  return readdirSync(AUTH_DIR)
    .filter((name) => name.endsWith('-page.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

/** Source without comments, so a comment that quotes a forbidden pattern does not count (or teach deleting it). */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

export function pageCode(page: string): string {
  return stripComments(readFileSync(join(AUTH_DIR, `${page}.ts`), 'utf8'));
}

export function pageTemplate(page: string): string {
  const file = join(AUTH_DIR, `${page}.html`);
  return existsSync(file) ? stripComments(readFileSync(file, 'utf8')) : '';
}
