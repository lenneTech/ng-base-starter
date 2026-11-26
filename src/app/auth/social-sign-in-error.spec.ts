/**
 * The text for an `?error=` the provider or Better Auth sends the browser back with, and the URL cleaning around it
 * (Nuxt template: `tests/unit/utils/social-sign-in.test.ts`, "?error= on the way back" and "cleaning the URL").
 */
import { hasSignInError, SOCIAL_SIGN_IN_NO_SESSION, socialSignInError, withoutSignInError } from './social-sign-in-error';

const REFUSED = {
  description: 'Dieses Konto ist für diese Anwendung nicht freigeschaltet. Bitte wende dich an deine Administration oder melde dich mit einem anderen Konto an.',
  title: 'Kein Zugang',
};
const INTERRUPTED = { description: 'Die Anmeldung hat zu lange gedauert oder wurde unterbrochen. Bitte starte sie erneut.', title: 'Anmeldung abgebrochen' };

describe('?error= on the way back', () => {
  it('shows nothing without a code', () => {
    expect(socialSignInError(undefined)).toBeNull();
    expect(socialSignInError(null)).toBeNull();
    expect(socialSignInError('')).toBeNull();
  });

  it('shows nothing when the silent attempt would have needed a page at the provider (OIDC Core 3.1.2.6)', () => {
    for (const code of ['login_required', 'interaction_required', 'consent_required', 'account_selection_required', 'LOGIN_REQUIRED', ' login_required ']) {
      expect(socialSignInError(code)).toBeNull();
    }
  });

  it('says that the account has no access for refusals', () => {
    for (const code of ['access_denied', 'signup_disabled', 'unauthorized_client', 'ACCESS_DENIED']) {
      expect(socialSignInError(code)).toEqual(REFUSED);
    }
  });

  it('asks to start again when the state of the sign-in is gone', () => {
    for (const code of ['state_mismatch', 'state_not_found', 'please_restart_the_process']) {
      expect(socialSignInError(code)).toEqual(INTERRUPTED);
    }
  });

  it('says that the address belongs to an account that signs in another way (account_not_linked)', () => {
    expect(socialSignInError('account_not_linked')).toEqual({
      description: 'Für diese E-Mail-Adresse gibt es bereits ein Konto mit einer anderen Anmeldeart. Bitte melde dich wie bisher an oder wende dich an die Administration.',
      title: 'Anmeldung nicht möglich',
    });
    // An API that keeps the password, or one whose answer is not known: the same text.
    expect(socialSignInError('account_not_linked', { passwordSignIn: true })).toEqual(socialSignInError('account_not_linked'));
  });

  it('sends a visitor to the provider used before when the API signs in through providers alone (account_not_linked)', () => {
    // `emailAndPassword: false`: "wie bisher" would point at a password nobody can use there.
    expect(socialSignInError('account_not_linked', { passwordSignIn: false })).toEqual({
      description:
        'Für diese E-Mail-Adresse gibt es bereits ein Konto, das nicht mit diesem Anbieter verbunden ist. Bitte melde dich über den Anbieter an, den du bisher genutzt hast, oder wende dich an die Administration.',
      title: 'Anmeldung nicht möglich',
    });
    // Every other code keeps its text.
    expect(socialSignInError('access_denied', { passwordSignIn: false })).toEqual(socialSignInError('access_denied'));
    expect(socialSignInError('state_mismatch', { passwordSignIn: false })).toEqual(socialSignInError('state_mismatch'));
  });

  it('names an unknown code for support, and the code the callback page sends when no session arrived', () => {
    expect(socialSignInError('server_error')).toEqual({
      description: 'Die Anmeldung wurde nicht abgeschlossen (Fehlercode: server_error). Bitte versuche es erneut.',
      title: 'Anmeldung fehlgeschlagen',
    });
    expect(SOCIAL_SIGN_IN_NO_SESSION).toBe('session_missing');
    expect(socialSignInError(SOCIAL_SIGN_IN_NO_SESSION)?.description).toContain('(Fehlercode: session_missing)');
  });

  it('does not take a message from the object prototype for a code', () => {
    expect(socialSignInError('constructor')?.title).toBe('Anmeldung fehlgeschlagen');
    expect(socialSignInError('__proto__')?.description).toContain('(Fehlercode: __proto__)');
    expect(socialSignInError('hasOwnProperty')?.description).toContain('(Fehlercode: hasOwnProperty)');
  });

  it('shows no text from the query that is not shaped like a code', () => {
    const generic = { description: 'Die Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut.', title: 'Anmeldung fehlgeschlagen' };
    for (const code of ['Bitte rufe 0800 123 an', '<img src=x onerror=alert(1)>', 'a'.repeat(65), 'evil.com/login', 'code-with-dash']) {
      expect(socialSignInError(code)).toEqual(generic);
    }
  });

  it('treats a repeated parameter as an unknown failure without repeating it', () => {
    expect(socialSignInError(['access_denied', 'Ruf an'])).toEqual({
      description: 'Die Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut.',
      title: 'Anmeldung fehlgeschlagen',
    });
  });
});

describe('cleaning the URL', () => {
  it('drops error and error_description and keeps every other parameter', () => {
    expect(withoutSignInError({ error: 'access_denied', error_description: 'Text', redirect: '/app/x', tab: '2' })).toEqual({ redirect: '/app/x', tab: '2' });
  });

  it('knows when there is something to clean', () => {
    expect(hasSignInError({ error: 'login_required' })).toBe(true);
    expect(hasSignInError({ error_description: 'Text' })).toBe(true);
    expect(hasSignInError({ error: '' })).toBe(true);
    expect(hasSignInError({ redirect: '/app' })).toBe(false);
    expect(hasSignInError({})).toBe(false);
  });
});
