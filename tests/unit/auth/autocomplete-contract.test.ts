/**
 * The e-mail field of an auth form says `autocomplete="username"` when the form has a password field, and `email`
 * when it has none (DEV-3147 in the Nuxt template). `username` is the token the password manager pairs with
 * `current-password`/`new-password`; `email` would address the profile autofill instead and offer less readily to save
 * a new credential. `type="email"` stays either way, so validation and the mobile keyboard do not change.
 */
import { describe, expect, it } from 'vitest';

import { authPages, pageTemplate } from './auth-page-sources';

/** Each `<form …>…</form>` of a template. */
function forms(template: string): string[] {
  return template.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
}

function emailInputs(form: string): string[] {
  return (form.match(/<input\b[^>]*>/g) ?? []).filter((input) => /\btype="email"/.test(input));
}

function hasPasswordField(form: string): boolean {
  return /<lt-password-input\b/.test(form) || /<input\b[^>]*\btype="password"[^>]*autocomplete="(?:current|new)-password"/.test(form);
}

const pagesWithEmail = authPages().filter((page) => forms(pageTemplate(page)).some((form) => emailInputs(form).length > 0));

describe('auth form autocomplete', () => {
  it('finds the e-mail fields DEV-3147 is about', () => {
    expect(pagesWithEmail).toEqual(expect.arrayContaining(['forgot-password-page', 'login-page', 'register-page', 'setup-page']));
  });

  it.each(pagesWithEmail)('%s names the token that matches its password field', (page) => {
    for (const form of forms(pageTemplate(page))) {
      const expected = hasPasswordField(form) ? 'username' : 'email';
      for (const input of emailInputs(form)) {
        expect(input, `${page}: the e-mail field needs autocomplete="${expected}"`).toContain(`autocomplete="${expected}"`);
      }
    }
  });

  it.each(authPages())('%s marks every password field current or new', (page) => {
    for (const field of pageTemplate(page).match(/<lt-password-input\b[^>]*>/g) ?? []) {
      expect(field, `${page}: ${field}`).toMatch(/autocomplete="(?:current|new)-password"/);
    }
  });
});
