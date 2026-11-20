/**
 * What the login page shows per social provider and which provider the silent attempt takes (Nuxt template:
 * `tests/unit/utils/social-sign-in.test.ts`, "provider buttons" to "the provider for the silent attempt").
 */
import {
  configuredSilentProvider,
  SILENT_SIGN_IN_FEATURES_TIMEOUT_MS,
  SOCIAL_PROVIDER_FALLBACK_ICON,
  SOCIAL_PROVIDER_ICONS,
  silentSignInProvider,
  socialProviderDisplay,
  socialProviderIcons,
  socialProvidersOf,
} from './social-providers';

describe('provider buttons', () => {
  it('names the providers Better Auth ships and gives Microsoft its four squares', () => {
    expect(socialProviderDisplay('microsoft')).toEqual({ icon: 'lucideGrid2x2', label: 'Microsoft' });
    expect(socialProviderDisplay('github')).toEqual({ icon: 'simpleGithub', label: 'GitHub' });
    expect(socialProviderDisplay('twitter')).toEqual({ icon: 'simpleX', label: 'X' });
    expect(socialProviderDisplay('google')).toEqual({ icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Google' });
  });

  it('names an unknown provider by its id, capitalised, with the neutral icon', () => {
    expect(socialProviderDisplay('keycloak')).toEqual({ icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Keycloak' });
  });

  it('does not take a name from the object prototype for a provider id', () => {
    expect(socialProviderDisplay('constructor')).toEqual({ icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: 'Constructor' });
    expect(socialProviderDisplay('__proto__')).toEqual({ icon: SOCIAL_PROVIDER_FALLBACK_ICON, label: '__proto__' });
  });

  it('hands out only icons the login page registers, each an SVG without a <title>', () => {
    for (const name of socialProviderIcons()) {
      expect(Object.keys(SOCIAL_PROVIDER_ICONS)).toContain(name);
    }
    for (const svg of Object.values(SOCIAL_PROVIDER_ICONS)) {
      expect(svg).toMatch(/^<svg[\s>]/);
      expect(svg).not.toContain('<title>');
    }
  });
});

describe('providers from /iam/features', () => {
  it('reads the listed ids', () => {
    expect(socialProvidersOf({ socialProviders: ['microsoft', 'github'] })).toEqual(['microsoft', 'github']);
  });

  it('drops what is not a provider id', () => {
    expect(socialProvidersOf(undefined)).toEqual([]);
    expect(socialProvidersOf(null)).toEqual([]);
    expect(socialProvidersOf({})).toEqual([]);
    expect(socialProvidersOf({ socialProviders: 'microsoft' })).toEqual([]);
    expect(socialProvidersOf({ socialProviders: ['microsoft', ' microsoft ', '', '  ', 7, null, { id: 'x' }, 'github'] })).toEqual(['microsoft', 'github']);
  });
});

describe('the provider for the silent attempt', () => {
  it('is configured with an id, known without the API (the server renders the first paint from it)', () => {
    expect(configuredSilentProvider('microsoft')).toBe('microsoft');
    expect(configuredSilentProvider('  microsoft  ')).toBe('microsoft');
    expect(configuredSilentProvider('')).toBeNull();
    expect(configuredSilentProvider('   ')).toBeNull();
    expect(configuredSilentProvider(undefined)).toBeNull();
    expect(configuredSilentProvider(true)).toBeNull();
    expect(configuredSilentProvider(['microsoft'])).toBeNull();
  });

  it('is the configured one while the API lists it', () => {
    expect(silentSignInProvider('microsoft', ['github', 'microsoft'])).toBe('microsoft');
    expect(silentSignInProvider('microsoft', ['github'])).toBeNull();
    expect(silentSignInProvider('microsoft', [])).toBeNull();
    expect(silentSignInProvider('', ['microsoft'])).toBeNull();
    expect(silentSignInProvider(undefined, ['microsoft'])).toBeNull();
  });

  it('waits three seconds for /iam/features', () => {
    expect(SILENT_SIGN_IN_FEATURES_TIMEOUT_MS).toBe(3000);
  });
});
