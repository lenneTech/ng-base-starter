/**
 * Renders the real `/auth/setup` page (setup-page.ts/.html with the real ng-base UI) in every state the setup status
 * can put it in. Port of the Nuxt template's `tests/unit/pages/auth-setup.test.ts`.
 *
 * WHAT IT PINS
 *
 * Since nest-server 12.4.0, `POST /system-setup/init` is closed outside `local`, `ci` and `e2e` unless
 * `systemSetup.httpInit` opens it, and `GET /system-setup/status` says so (`httpInitEnabled`, `httpInitTokenRequired`).
 * The page shows the form only while the API takes the first admin over HTTP: with the init closed the form would fail
 * with 403 on every submit, so it shows how to set the system up through the configuration instead. A token the API
 * asks for gets its own field, and a refused submit shows the backend's message from the response body, not the
 * transport line the error's `message` carries.
 *
 * The round trip against a real API, open and closed, is `tests/e2e/system-setup.spec.ts`. The token case would need a
 * third API start there, so it is pinned here; sending the token as the `X-System-Setup-Token` header is ng-base's
 * part and tested there.
 *
 * HOW
 *
 * `LtSystemSetupService` is a fake with the contract of ng-base 22 (`null` until the status is read; after a 403,
 * `initSetup` has re-read the status before it rethrows). Toast and error translation are fakes that record what the
 * page shows. The form is the page's own Signal Form: the spec types into its inputs and presses its submit button, so
 * the page's validators decide, and reads the messages the fields show. TestBed rethrows every application error, so
 * a case that throws fails; that is what the Nuxt cases check with `errors: []`.
 */
import { computed, signal, type WritableSignal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { LtSystemSetupService, type LtSystemSetupInput } from '@lenne.tech/ng-base/auth';

import { SetupPage } from './setup-page';

interface Status {
  httpInitEnabled: boolean | null;
  httpInitTokenRequired: boolean | null;
  needsSetup: boolean | null;
}

type Field = 'confirmPassword' | 'email' | 'name' | 'password' | 'token';

const OPEN: Status = { httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: true };
const CLOSED: Status = { httpInitEnabled: false, httpInitTokenRequired: false, needsSetup: true };
const ADMIN = { confirmPassword: 'Passw0rd!long', email: 'admin@test.com', name: 'Erster Admin', password: 'Passw0rd!long' };

/** The id of each field's input in `setup-page.html`. */
const INPUT_IDS: Record<Field, string> = {
  confirmPassword: 'setup-confirm-password',
  email: 'setup-email',
  name: 'setup-name',
  password: 'setup-password',
  token: 'setup-token',
};

/**
 * A refused init: the transport line in `message`, the backend's message in the response body (`data`). Only a page
 * that hands the error itself to the translation, not its `message`, gets to the `#LTNS_` code.
 */
function setupError(code: string): Error {
  return Object.assign(new Error('[POST] "http://localhost:3000/system-setup/init": 403 Forbidden'), {
    data: { message: `#${code}: Refused`, statusCode: 403 },
    status: 403,
    statusCode: 403,
  });
}

/** As ng-base: the backend message from the response body wins over the thrown message. */
function translateError(error: unknown): string {
  const body = typeof error === 'object' && error !== null ? (error as { data?: { message?: unknown } }).data?.message : undefined;
  const message = typeof body === 'string' ? body : error instanceof Error ? error.message : String(error);
  if (message.startsWith('#LTNS_0053')) {
    return 'Ersteinrichtung gesperrt';
  }
  return message.startsWith('#LTNS_0054') ? 'Setup-Token falsch' : message;
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function renderPage(initial: Status, initSetup: (input: LtSystemSetupInput, status: WritableSignal<Status>) => Promise<void> = async () => {}) {
  const status = signal<Status>({ ...initial });
  const toasts: LtToastOptions[] = [];
  const init = vi.fn(async (input: LtSystemSetupInput) => initSetup(input, status));

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: LtSystemSetupService,
        useValue: {
          checkSetupStatus: vi.fn(async () => ({ ...status() })),
          httpInitEnabled: computed(() => status().httpInitEnabled),
          httpInitTokenRequired: computed(() => status().httpInitTokenRequired),
          initSetup: init,
          needsSetup: computed(() => status().needsSetup),
        },
      },
      {
        provide: LtToastService,
        useValue: {
          show: (toast: LtToastOptions) => {
            toasts.push(toast);
            return true;
          },
        },
      },
      { provide: LtErrorTranslationService, useValue: { translateError } },
    ],
  });
  const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(SetupPage);
  await settle(fixture);
  const root = fixture.nativeElement as HTMLElement;
  const form = (): HTMLFormElement | null => root.querySelector('form');

  return {
    /** The ids of the form's inputs, in order; empty without a form. */
    fieldIds: () => [...(form()?.querySelectorAll('input') ?? [])].map((input) => input.id),
    form,
    init,
    input: (field: Field) => root.querySelector<HTMLInputElement>(`input#${INPUT_IDS[field]}`),
    navigateByUrl,
    root,
    /** Types `data` into the form, presses its submit button and returns the messages the fields show then. */
    async submit(data: Partial<Record<Field, string>>): Promise<string[]> {
      for (const [field, value] of Object.entries(data) as Array<[Field, string]>) {
        const input = root.querySelector<HTMLInputElement>(`input#${INPUT_IDS[field]}`);
        if (!input) {
          throw new Error(`no input for ${field}`);
        }
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await fixture.whenStable();
      form()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await settle(fixture);
      return [...root.querySelectorAll('hlm-field-error')].map((error) => error.textContent?.trim() ?? '');
    },
    text: () => root.textContent ?? '',
    toasts,
  };
}

describe('setup page', () => {
  it('shows the form while the API takes the first admin over HTTP, without a token field', async () => {
    const page = await renderPage(OPEN);

    expect(page.fieldIds()).toEqual(['setup-name', 'setup-email', 'setup-password', 'setup-confirm-password']);
    expect(page.text()).not.toContain('NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL');
  });

  it('shows how to set the system up through the configuration while the HTTP init is closed, and links to the login', async () => {
    const page = await renderPage(CLOSED);

    expect(page.form()).toBeNull();
    for (const variable of [
      'NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL',
      'NSC__SYSTEM_SETUP__INITIAL_ADMIN__PASSWORD',
      'NSC__SYSTEM_SETUP__INITIAL_ADMIN__NAME',
      'NSC__SYSTEM_SETUP__HTTP_INIT__TOKEN',
    ]) {
      expect(page.text()).toContain(variable);
    }
    expect(page.root.querySelector('a[href="/auth/login"]')).not.toBeNull();
  });

  it('shows neither form nor hint while the status is unknown', async () => {
    const page = await renderPage({ httpInitEnabled: null, httpInitTokenRequired: null, needsSetup: null });

    expect(page.form()).toBeNull();
    expect(page.text()).not.toContain('NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL');
    expect(page.text()).toContain('Einrichtungsstatus wird geprüft');
  });

  it('says the system is set up, and links to the login, once no setup is needed', async () => {
    const page = await renderPage({ httpInitEnabled: true, httpInitTokenRequired: false, needsSetup: false });

    expect(page.form()).toBeNull();
    expect(page.text()).toContain('bereits eingerichtet');
    expect(page.root.querySelector('a[href="/auth/login"]')).not.toBeNull();
  });

  it('creates the admin, confirms it and goes to the login', async () => {
    const page = await renderPage(OPEN);

    expect(await page.submit(ADMIN)).toEqual([]);

    expect(page.init).toHaveBeenCalledExactlyOnceWith({ email: ADMIN.email, name: ADMIN.name, password: ADMIN.password, token: undefined });
    expect(page.toasts).toEqual([expect.objectContaining({ color: 'success' })]);
    expect(page.navigateByUrl).toHaveBeenCalledWith('/auth/login');
  });

  it('asks for the setup token when the API requires one, and hands it to initSetup', async () => {
    const page = await renderPage({ ...OPEN, httpInitTokenRequired: true });
    const token = page.input('token');

    expect(token?.type).toBe('password');
    // The field is marked required (LtFormField's asterisk) …
    expect(page.root.querySelector('label[for="setup-token"]')?.textContent).toContain('*');
    // … and the form does not go out without it.
    expect(await page.submit(ADMIN)).toEqual(['Setup-Token ist erforderlich']);
    expect(page.init).not.toHaveBeenCalled();

    expect(await page.submit({ ...ADMIN, token: 'setup-token-with-letters' })).toEqual([]);
    expect(page.init).toHaveBeenCalledWith(expect.objectContaining({ token: 'setup-token-with-letters' }));
  });

  it('shows the backend message of a refused submit, not the transport line', async () => {
    const page = await renderPage({ ...OPEN, httpInitTokenRequired: true }, async () => {
      throw setupError('LTNS_0054');
    });

    await page.submit({ ...ADMIN, token: 'wrong-setup-token-x' });

    expect(page.toasts).toEqual([expect.objectContaining({ color: 'error', description: 'Setup-Token falsch' })]);
    expect(page.navigateByUrl).not.toHaveBeenCalled();
  });

  it('switches to the hint when the API closed the HTTP init in the meantime', async () => {
    // As ng-base 22: after a 403, initSetup has re-read the status before it rethrows.
    const page = await renderPage(OPEN, async (_input, status) => {
      status.set({ ...CLOSED });
      throw setupError('LTNS_0053');
    });

    await page.submit(ADMIN);

    expect(page.toasts).toEqual([expect.objectContaining({ color: 'error', description: 'Ersteinrichtung gesperrt' })]);
    expect(page.form()).toBeNull();
    expect(page.text()).toContain('NSC__SYSTEM_SETUP__INITIAL_ADMIN__EMAIL');
  });
});
