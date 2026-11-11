/**
 * `/auth/2fa`: what the page says when the second factor is refused (the Nuxt template's `pages/auth/2fa.vue`,
 * nuxt-base-starter #38).
 *
 * Better Auth refuses a second factor for reasons other than a wrong code: an expired challenge
 * (`INVALID_TWO_FACTOR_COOKIE`), too many attempts on one challenge (`TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`) and a
 * temporarily locked account (`ACCOUNT_TEMPORARILY_LOCKED`). They carry no `#…_0000:` code to translate, so the page
 * used to show each as "Code ungültig", and the user retried a code that could never work. A spent challenge sends the
 * user back to the sign-in (with the deep link), a lock asks them to wait.
 */
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { type LtAuthResponse, LtAuthService } from '@lenne.tech/ng-base/auth';

import { TwoFactorPage } from './two-factor-page';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function submitCode(answer: LtAuthResponse, redirect?: string) {
  const toasts: LtToastOptions[] = [];
  const verifyTotp = vi.fn(async () => answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LtAuthService, useValue: { twoFactor: { verifyBackupCode: verifyTotp, verifyTotp } } },
      { provide: LtErrorTranslationService, useValue: { translateError: (message: string) => `übersetzt: ${message}` } },
      { provide: LtToastService, useValue: { show: (options: LtToastOptions) => toasts.push(options) } },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(TwoFactorPage);
  if (redirect) {
    fixture.componentRef.setInput('redirect', redirect);
  }
  await settle(fixture);

  const root = fixture.nativeElement as HTMLElement;
  const input = root.querySelector<HTMLInputElement>('#two-factor-code');
  if (!input) {
    throw new Error('code input missing');
  }
  input.value = '123456';
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
  root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await settle(fixture);

  return { navigate, navigateByUrl, toasts, verifyTotp };
}

describe('TwoFactorPage: refused second factor', () => {
  it('says "Code ungültig" for a wrong code and stays on the page', async () => {
    const { navigate, navigateByUrl, toasts, verifyTotp } = await submitCode({ error: { code: 'INVALID_CODE', message: 'Invalid code', status: 401 } });

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(toasts).toEqual([expect.objectContaining({ description: 'Code ungültig', title: 'Bestätigung fehlgeschlagen' })]);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('sends the user back to the sign-in, with the deep link, when the challenge expired', async () => {
    const { navigate, toasts } = await submitCode({ error: { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'Invalid two factor cookie', status: 401 } }, '/app/settings');

    expect(toasts).toEqual([expect.objectContaining({ description: 'Die Bestätigung ist abgelaufen. Bitte melde dich erneut an.' })]);
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { redirect: '/app/settings' } });
  });

  it('sends the user back to the sign-in after too many attempts on one challenge', async () => {
    const { navigate, toasts } = await submitCode({ error: { code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', message: 'Too many attempts', status: 400 } });

    expect(toasts).toEqual([expect.objectContaining({ description: 'Zu viele Versuche mit diesem Code. Bitte melde dich erneut an.' })]);
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { redirect: '/app' } });
  });

  it('asks the user to wait while the account is locked, and stays on the page', async () => {
    const { navigate, toasts } = await submitCode({ error: { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'Account locked', status: 423 } });

    expect(toasts).toEqual([expect.objectContaining({ description: 'Zu viele Fehlversuche. Die Bestätigung ist für einige Minuten gesperrt, bitte versuche es später erneut.' })]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('translates a message with an error code, a project code included', async () => {
    const { toasts } = await submitCode({ error: { message: '#PROJ_0001: Gesperrt', status: 403 } });

    expect(toasts).toEqual([expect.objectContaining({ description: 'übersetzt: #PROJ_0001: Gesperrt' })]);
  });
});
