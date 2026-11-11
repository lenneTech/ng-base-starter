# Migration Guide: "Passwort vergessen?" by keyboard, German sign-in and sign-out labels

Two defects in the templates the starter ships, both found in a project review, and the same fix as in the Nuxt
template:

- The login page's "Passwort vergessen?" link carried `tabindex="-1"`. A keyboard user could not reach the password
  reset at all (WCAG 2.1.1). The link now sits in the tab order after the password field and its show/hide button.
- The header named its sign-out button "Logout" (`aria-label` and tooltip) and its sign-in link "Login", in an
  otherwise German interface. They are now "Abmelden" and "Anmelden".

| Project                                                     | What to do               |
| ----------------------------------------------------------- | ------------------------ |
| Kept `src/app/auth/login-page.html` / `default-layout.html` | Steps 1-3                |
| Has its own login page and header                           | Check both defects there |

No dependency and no API change are needed.

## Upgrade steps (existing project)

In an `lt fullstack` monorepo, the steps happen in `projects/app/`.

### 1. The link

In `src/app/auth/login-page.html`, remove `tabindex="-1"` from the `<a routerLink="/auth/forgot-password">`.

### 2. The labels

In `src/app/layout/default-layout.html`:

- the sign-out button: `aria-label="Abmelden" hlmTooltip="Abmelden"` instead of `"Logout"`;
- the sign-in link: the text `Anmelden` instead of `Login`.

### 3. Tests that look for the old names

E2E specs that find the sign-out button by `getByLabel('Logout')` or `getByRole('button', { name: 'Logout' })` move to
`getByLabel('Abmelden', { exact: true })`. Use the label, not the role: `/app` has a second, visible "Abmelden" button,
and a role query then matches two elements. The starter's own specs changed the same way (`auth-lifecycle`,
`auth-multiple-passkeys`, `ai-visibility`), and `auth-password-reset.spec.ts` has a new case that tabs from the
password field to the link and opens it with Enter.

A query for the header's sign-in link by name `Anmelden` would now also match other "Anmelden" links (the register
page's footer). The starter's specs only ever click the login form's submit button (`getByRole('button', { name:
'Anmelden', exact: true })`), which stays unique.

## Check it

`pnpm run test:e2e` passes. By hand: open `/auth/login`, click into the password field, press Tab until "Passwort
vergessen?" is focused (two presses), press Enter: `/auth/forgot-password` opens.