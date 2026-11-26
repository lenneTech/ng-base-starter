/**
 * Renders the real `/app/settings/security` page with the answers `/iam/features` can give (Nuxt template:
 * `tests/unit/pages/settings-security-features.test.ts`).
 *
 * WHAT IT PINS
 *
 * The page offers two-factor authentication and passkeys only while the API supports them. nest-server 12.11.0+ reports
 * `twoFactor: false` and `passkey: false` when the plugin is off, by default for an API that signs in through providers
 * alone (`emailAndPassword: false`). The endpoints answer 404 there, so a section shown anyway fails on every click
 * ("2FA aktivieren", "Passkey hinzufügen"), and loading the passkey list logs an error on every visit. Only an explicit
 * `false` hides a section: an older API that reports neither field keeps both. With neither factor left, the page says
 * why instead of showing the account card alone.
 *
 * The provider-only case cannot run against a real API in E2E: nobody can sign in there without a real provider round
 * trip. The page with both factors on is walked by `tests/e2e/auth-comprehensive.spec.ts`.
 *
 * HOW
 *
 * `LtAuthService` is a fake with a `features` signal and a recording `passkey.list`; the overlay, toast and error
 * translation are fakes. The real template renders with the real ng-base UI.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { LtOverlayService } from '@lenne.tech/ng-base/ui';

import { SecurityPage } from './security-page';

const USER = { email: 'max@example.com', emailVerified: true, id: 'u1', name: 'Max' };

async function renderPage(features: Record<string, unknown>) {
  const list = vi.fn(async () => ({ data: [], error: null }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: LtAuthService,
        useValue: {
          features: signal(features),
          fetchFeatures: vi.fn(async () => features),
          is2FAEnabled: signal(false),
          passkey: { delete: vi.fn(), list },
          registerPasskey: vi.fn(),
          setUser: vi.fn(),
          twoFactor: { disable: vi.fn(), enable: vi.fn(), verifyTotp: vi.fn() },
          user: signal(USER),
        },
      },
      { provide: LtErrorTranslationService, useValue: { translateError: (message: string) => message } },
      { provide: LtOverlayService, useValue: { open: vi.fn() } },
      { provide: LtToastService, useValue: { show: vi.fn(() => true) } },
    ],
  });
  const fixture = TestBed.createComponent(SecurityPage);
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
  const root = fixture.nativeElement as HTMLElement;
  const text = (): string => root.textContent?.replace(/\s+/g, ' ') ?? '';
  return {
    /** The section headings, in order. */
    headings: () => [...root.querySelectorAll('h2')].map((heading) => heading.textContent?.trim()),
    /** The text of the hint above the sections, or null without one. */
    hint: () => root.querySelector('lt-notice')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    list,
    text,
  };
}

describe('SecurityPage: the sections follow /iam/features', () => {
  it('offers two-factor authentication and passkeys while the API supports both', async () => {
    const page = await renderPage({ emailAndPassword: true, passkey: true, twoFactor: true });

    expect(page.headings()).toEqual(['Zwei-Faktor-Authentifizierung', 'Passkeys', 'Kontoinformationen']);
    expect(page.text()).toContain('2FA aktivieren');
    expect(page.text()).toContain('Passkey hinzufügen');
    expect(page.hint()).toBeNull();
    expect(page.list).toHaveBeenCalledTimes(1);
  });

  it('keeps both sections for an API that reports neither field', async () => {
    const page = await renderPage({});

    expect(page.headings()).toEqual(['Zwei-Faktor-Authentifizierung', 'Passkeys', 'Kontoinformationen']);
    expect(page.list).toHaveBeenCalledTimes(1);
  });

  it('leaves out what the API reports off, and does not ask for passkeys it does not keep', async () => {
    const noPasskeys = await renderPage({ passkey: false, twoFactor: true });
    expect(noPasskeys.headings()).toEqual(['Zwei-Faktor-Authentifizierung', 'Kontoinformationen']);
    expect(noPasskeys.text()).not.toContain('Passkey hinzufügen');
    expect(noPasskeys.list).not.toHaveBeenCalled();
    expect(noPasskeys.hint()).toBeNull();

    TestBed.resetTestingModule();
    const noTwoFactor = await renderPage({ passkey: true, twoFactor: false });
    expect(noTwoFactor.headings()).toEqual(['Passkeys', 'Kontoinformationen']);
    expect(noTwoFactor.text()).not.toContain('2FA aktivieren');
    expect(noTwoFactor.hint()).toBeNull();
  });

  it('says where the factors live when the API signs in through providers alone', async () => {
    // nest-server 12.11.0+ with `betterAuth.emailAndPassword.enabled: false`.
    const page = await renderPage({ emailAndPassword: false, passkey: false, socialProviders: ['github'], twoFactor: false });

    expect(page.headings()).toEqual(['Kontoinformationen']);
    expect(page.text()).not.toContain('2FA aktivieren');
    expect(page.text()).not.toContain('Passkey hinzufügen');
    expect(page.hint()).toContain('Keine weiteren Anmeldefaktoren');
    expect(page.hint()).toContain('in deinem Konto bei diesem Anbieter');
    expect(page.list).not.toHaveBeenCalled();
  });

  it('says the factors are not set up when an API with a password has both off', async () => {
    const page = await renderPage({ emailAndPassword: true, passkey: false, twoFactor: false });

    expect(page.headings()).toEqual(['Kontoinformationen']);
    expect(page.hint()).toContain('Zwei-Faktor-Authentifizierung und Passkeys sind für diese Anwendung nicht eingerichtet.');
  });
});
