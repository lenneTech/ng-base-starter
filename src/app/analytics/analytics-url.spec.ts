/**
 * What Plausible may see of a page URL: nothing that names a person or opens an account.
 *
 * Auth links carry live secrets in the query, project routes carry them in the path. Left alone, the
 * tracker reports `location.href` the moment it starts, before any page can strip anything, and it
 * repeats that URL in the `engagement` event when the page is left. The first request of a reset link
 * therefore handed a working token to the analytics host, and `verify-email` added the e-mail address.
 *
 * Each rule of `analyticsUrl` has a case below that fails without that rule. The rules overlap on
 * purpose, so a case often has to be one that only its own rule catches: an ObjectId of letters only
 * would read as a word to the length rule.
 *
 * The tracker test runs the real package, because the engagement half is its behaviour, not ours:
 * should an update stop reusing the pageview's URL, this has to go red.
 */
import { track as plausibleTrack, init } from '@plausible-analytics/tracker';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { routes } from '../app.routes';
import { analyticsReferrer, analyticsUrl, reportPageviews, staticRoutes } from './analytics-url';
import { routePaths } from './route-resolver';

const SECRET_URL = 'https://app.example/auth/reset-password?token=live-token&email=person%40test.com';

const originalLocation = window.location;

/** `src/test-setup.ts` replaces `location` with a writable plain object, so a navigation is a new value. */
function setLocation(value: unknown): void {
  Object.defineProperty(window, 'location', { value });
}

function visit(url: string): void {
  setLocation(new URL(url));
}

const reported = (path: string): string => analyticsUrl(`https://app.example${path}`).slice('https://app.example'.length);

const projectRoot = join(import.meta.dirname, '..', '..', '..');

/** Every route of the app as the router knows it (`app.routes.ts`), parameters and wildcards included. */
function pageRoutes(): string[] {
  return routePaths(routes);
}

/** A router's ranking in small: a static route wins over a dynamic one; a parameter takes one segment, a catch-all the rest. */
function routerOf(paths: string[]): { resolve: (to: string) => { matched: { path: string }[] } } {
  const records = [...paths].sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')));
  const matcher = (path: string): RegExp =>
    new RegExp(
      `^${path
        .split('/')
        .map((segment) => (segment.includes('(.*)') ? '.*' : segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/')}/?$`,
      'i',
    );
  return {
    resolve: (to) => ({
      matched: records
        .filter((path) => matcher(path).test(to))
        .slice(0, 1)
        .map((path) => ({ path })),
    }),
  };
}

describe('analyticsUrl with the routes of the app', () => {
  const isStaticRoute = staticRoutes(routerOf(['/invite/accept', '/invite/:code', '/app/records/:id']));

  it('leaves every static page of the project as it is, and still drops its query', () => {
    const routes = pageRoutes();
    const check = staticRoutes(routerOf(routes));
    const staticPages = routes.filter((route) => !route.includes(':'));

    expect(staticPages.length).toBeGreaterThan(0);
    for (const route of staticPages) {
      expect(analyticsUrl(`https://app.example${route}?token=live-token`, check)).toBe(`https://app.example${route}`);
    }
  });

  it('keeps a static page behind a token word: `/invite/accept` next to `/invite/[code]`', () => {
    expect(analyticsUrl('https://app.example/invite/accept?token=live-token', isStaticRoute)).toBe('https://app.example/invite/accept');
  });

  it('masks the dynamic route next to it', () => {
    expect(analyticsUrl('https://app.example/invite/aB3dE', isStaticRoute)).toBe('https://app.example/invite/:id');
  });

  it('masks what the rules catch in a dynamic route', () => {
    expect(analyticsUrl('https://app.example/app/records/12345', isStaticRoute)).toBe('https://app.example/app/records/:id');
  });

  it('masks a dynamic child under a static parent route, which the router lists after the parent', () => {
    // `app` + `orders/:id` below it: the real router resolves to the whole chain.
    const nested = staticRoutes({ resolve: () => ({ matched: [{ path: '/app' }, { path: '/app/orders/:id()' }] }) });

    expect(analyticsUrl('https://app.example/app/orders/6630f1c2a9b8c7d6e5f40312', nested)).toBe('https://app.example/app/orders/:id');
  });

  it('masks a path no route knows', () => {
    expect(analyticsUrl('https://app.example/share/aB3dE', isStaticRoute)).toBe('https://app.example/share/:id');
  });

  it('masks a path the router rejects', () => {
    const rejecting = staticRoutes({
      resolve: () => {
        throw new Error('no route');
      },
    });

    expect(analyticsUrl('https://app.example/invite/accept', rejecting)).toBe('https://app.example/invite/:id');
  });
});

describe('analyticsUrl: the path', () => {
  it('keeps a slug, however long', () => {
    expect(reported('/blog/rueckblick-auf-das-jahr-2026')).toBe('/blog/rueckblick-auf-das-jahr-2026');
  });

  it('masks an ObjectId, even one that reads as letters', () => {
    expect(reported('/app/records/abcdefabcdefabcdefabcdef/edit')).toBe('/app/records/:id/edit');
  });

  it('masks a UUID, even one whose groups read as words', () => {
    expect(reported('/app/files/abcdefab-cdef-1234-abcd-cdefabcdefab')).toBe('/app/files/:id');
  });

  it('masks a number of five digits or more, and keeps a shorter one', () => {
    expect(reported('/orders/12345/2026')).toBe('/orders/:id/2026');
  });

  it.each([
    ['as it is', '/users/max@test.com'],
    ['percent-encoded', '/users/max%40test.com'],
  ])('masks an e-mail address %s', (_label, path) => {
    expect(reported(path)).toBe('/users/:id');
  });

  it('masks a token of 16 characters or more', () => {
    expect(reported('/x/aB3dE5fG7hJ9kL1m')).toBe('/x/:id');
  });

  it('masks a long token of letters only, which reads as a word only to a pattern that ignores case', () => {
    expect(reported('/x/AbCdEfGhIjKlMnOpQ')).toBe('/x/:id');
  });

  it.each(['invite', 'koppeln', 'password-reset', 'passwort-setzen', 'reset', 's', 'share', 'token', 'verify'])(
    'masks the short code after `%s`, whatever it looks like',
    (word) => {
      expect(reported(`/${word}/aB3dE`)).toBe(`/${word}/:id`);
    },
  );

  it('recognises the word in front of a code in any case', () => {
    expect(reported('/Share/aB3dE')).toBe('/Share/:id');
  });
});

describe('analyticsUrl: the query', () => {
  it.each(['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'])('keeps the campaign label `%s`', (name) => {
    expect(reported(`/?${name}=herbst-aktion`)).toBe(`/?${name}=herbst-aktion`);
  });

  it('keeps a label made of dotted parts', () => {
    expect(reported('/?ref=partner.example.com')).toBe('/?ref=partner.example.com');
  });

  it.each(['utm_term', 'utm_content'])('drops `%s`, which often holds free text or a recipient id', (name) => {
    expect(reported(`/?${name}=mail`)).toBe('/');
  });

  it.each([
    ['free text', 'Max Mustermann'],
    ['an e-mail address', 'max@test.com'],
    ['more than 64 characters', 'a'.repeat(65)],
  ])('drops a campaign value with %s', (_label, value) => {
    expect(reported(`/?utm_source=${encodeURIComponent(value)}`)).toBe('/');
  });

  it.each([
    ['an ObjectId', 'abcdefabcdefabcdefabcdef'],
    ['a long number', '12345678'],
    ['a token', 'aB3dE5fG7hJ9kL1m'],
    ['a token in a dotted part', 'newsletter.aB3dE5fG7hJ9kL1m'],
  ])('drops a campaign value that is %s', (_label, value) => {
    expect(reported(`/?utm_campaign=${value}`)).toBe('/');
  });

  it.each(['gclid', 'msclkid'])('reports that `%s` was there, never its value', (name) => {
    expect(reported(`/?${name}=Cj0KCQiA-live-click-id`)).toBe(`/?${name}=1`);
  });

  it.each([
    ['a reset token', '/auth/reset-password?token=live-token', '/auth/reset-password'],
    ['a verification token and an address', '/auth/verify-email?token=live-token&email=a%40test.com', '/auth/verify-email'],
    ['a sign-in deep link', '/auth/login?redirect=/app/records/42', '/auth/login'],
    ['a parameter nobody thought of', '/invite?code=live-code', '/invite'],
    ['a fragment', '/auth/reset-password#token=live-token', '/auth/reset-password'],
  ])('drops %s', (_label, path, expected) => {
    expect(reported(path)).toBe(expected);
  });

  it('keeps a campaign label next to a secret, and only that', () => {
    expect(reported('/auth/register?utm_source=mail&token=live-token')).toBe('/auth/register?utm_source=mail');
  });
});

describe('analyticsReferrer', () => {
  it('keeps the origin of a full URL and nothing else', () => {
    expect(analyticsReferrer('https://mail.example/inbox/abcdefabcdefabcdefabcdef?q=max%40test.com#read')).toBe('https://mail.example');
  });

  it.each([
    ['none', ''],
    ['no value', null],
    ['an opaque origin', 'data:text/html,hello'],
    ['something that is no URL', 'not a url'],
  ])('reports nothing for %s', (_label, referrer) => {
    expect(analyticsReferrer(referrer)).toBeNull();
  });
});

describe('reportPageviews', () => {
  const start = () => {
    const afterEachHooks: Array<() => void> = [];
    const report = vi.fn();
    const router = {
      afterEach: (hook: () => void) => {
        afterEachHooks.push(hook);
        return () => {};
      },
    };
    reportPageviews(report, router);
    return { navigate: () => afterEachHooks.forEach((hook) => hook()), report };
  };

  afterEach(() => {
    setLocation(originalLocation);
  });

  it('reports a static page of the app whole, through the router it is given', () => {
    visit('https://app.example/invite/accept?token=live-token');
    const report = vi.fn();

    reportPageviews(report, { afterEach: () => () => {}, ...routerOf(['/invite/accept', '/invite/:code']) });

    expect(report).toHaveBeenCalledExactlyOnceWith({ url: 'https://app.example/invite/accept' });
  });

  it('reports the first page at once, without its secrets', () => {
    visit(SECRET_URL);

    const { report } = start();

    expect(report).toHaveBeenCalledExactlyOnceWith({ url: 'https://app.example/auth/reset-password' });
  });

  it('reports a new path, like the tracker would', () => {
    visit('https://app.example/auth/login');
    const { navigate, report } = start();

    visit('https://app.example/app');
    navigate();

    expect(report).toHaveBeenLastCalledWith({ url: 'https://app.example/app' });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('keeps a secret out of a navigation inside the app', () => {
    visit('https://app.example/auth/register');
    const { navigate, report } = start();

    // A project page may still carry the address in the query.
    visit('https://app.example/auth/verify-email?email=person%40test.com&fromRegister=true');
    navigate();

    expect(report).toHaveBeenLastCalledWith({ url: 'https://app.example/auth/verify-email' });
  });

  it('keeps a secret out of a return from the back/forward cache', () => {
    visit(SECRET_URL);
    const { report } = start();

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ url: 'https://app.example/auth/reset-password' });
  });

  it('does not report a navigation that stays on the path', () => {
    visit(SECRET_URL);
    const { navigate, report } = start();

    // What `router.replace` does when the page strips its token.
    visit('https://app.example/auth/reset-password');
    navigate();

    expect(report).toHaveBeenCalledOnce();
  });

  it('reports a return from the back/forward cache, like the tracker would', () => {
    visit('https://app.example/app');
    const { report } = start();

    // happy-dom's PageTransitionEvent drops `persisted`.
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));

    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe('the real tracker', () => {
  const sentBodies: string[] = [];

  beforeAll(() => {
    vi.stubGlobal('fetch', async (_url: string, request: { body: string }) => {
      sentBodies.push(request.body);
      return new Response(null, { status: 202 });
    });
    init({ autoCapturePageviews: false, captureOnLocalhost: true, domain: 'app.example', endpoint: 'https://analytics.example/api/event' });
  });

  it('reports `location.href` when left alone, which is why the page cannot be trusted to it', async () => {
    visit(SECRET_URL);
    sentBodies.length = 0;

    plausibleTrack('pageview', {});

    await vi.waitFor(() => expect(sentBodies.join()).toContain('live-token'));
  });

  it('keeps the secret out of the pageview and of the engagement event that repeats its URL', async () => {
    visit(SECRET_URL);
    plausibleTrack('pageview', { url: analyticsUrl(window.location.href) });
    sentBodies.length = 0;

    // The next pageview closes the previous one with an `engagement` event.
    plausibleTrack('pageview', { url: 'https://app.example/auth/login' });

    await vi.waitFor(() => expect(sentBodies.some((body) => body.includes('"engagement"'))).toBe(true));
    expect(sentBodies.join()).not.toContain('live-token');
    expect(sentBodies.join()).not.toContain('person');
  });
});

describe('the Plausible provider', () => {
  it('leaves pageviews to `reportPageviews`, because the tracker would report the token first', () => {
    // The tracker is configured in `plausible-start.ts`, which `providePlausible()` loads once a host is set.
    const source = readFileSync(join(projectRoot, 'src', 'app', 'analytics', 'plausible-start.ts'), 'utf8');

    expect(source).toMatch(/autoCapturePageviews: false,/);
  });
});
