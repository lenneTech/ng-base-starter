/**
 * Plausible runs only with an explicitly set analytics host, and then sends nothing that names a person.
 *
 * Port of the Nuxt template's `tests/unit/plugins/plausible-tracker.test.ts`, `plausible-pageviews.test.ts` and
 * `plausible-tracker-real.test.ts`. The masks themselves (`analyticsUrl`, `analyticsReferrer`, `reportPageviews`) and
 * the route resolution are pinned in `analytics-url.spec.ts` and `route-resolver.spec.ts`; this file pins that
 * `providePlausible()` (src/app/analytics/plausible.ts) puts them in front of the tracker.
 *
 * `providePlausible()` starts the tracker in the browser, and only while the runtime config carries a host
 * (`NG_PUBLIC_PLAUSIBLE_API_HOST`, written as `plausibleApiHost` by `src/server.ts`). Without one there is no tracker,
 * no request, no preconnect, never a fallback to plausible.io. With one, the tracker's own pageview capture stays off
 * (it would report `location.href` the moment it starts, token and all), pageviews come from `reportPageviews`, and the
 * tracker's `transformRequest` passes every event's URL, its referrer and the `url` prop the tracker adds to a click on
 * a tagged link through the masks.
 *
 * HOW
 *
 * The first two blocks mock the tracker package (`vi.mock` of a package works with the Angular unit-test builder) and
 * read what `providePlausible()` hands it. The last block runs the real package with exactly that configuration: should
 * an update add a property of its own, or send one past the hook, it has to go red. The real tracker takes one `init()`
 * per module instance, and `ng test` runs spec files in shared workers (`isolate: false`), where another spec may have
 * started the shared instance already, so the block imports a fresh instance by its file URL and only counts requests
 * to its own endpoint.
 */
import { ApplicationInitStatus, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { LT_RUNTIME_CONFIG } from '@lenne.tech/ng-base';
import type { PlausibleConfig, PlausibleEventOptions, PlausibleRequestPayload } from '@plausible-analytics/tracker';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { providePlausible } from './plausible';

interface Tracker {
  init(config: PlausibleConfig): void;
  track(eventName: string, options: PlausibleEventOptions): void;
}

const tracker = vi.hoisted(() => ({
  init: vi.fn<(config: PlausibleConfig) => void>(),
  track: vi.fn<(eventName: string, options: PlausibleEventOptions) => void>(),
}));
vi.mock('@plausible-analytics/tracker', () => tracker);

const HOST = 'https://stats.example';

/** The app's routes, in small: `/invite/accept` is a static page, everything else is a catch-all. */
const ROUTES: Routes = [
  { path: 'invite/accept', redirectTo: '/' },
  { path: '**', redirectTo: '/' },
];

const originalLocation = window.location;

/** `src/test-setup.ts` replaces `location` with a writable plain object, so a navigation is a new value. */
function visit(href: string): void {
  Object.defineProperty(window, 'location', { value: new URL(href) });
}

function preconnects(): Array<null | string> {
  return [...document.head.querySelectorAll('link[rel="preconnect"]')].map((link) => link.getAttribute('href'));
}

interface BootOptions {
  href?: string;
  platform?: 'browser' | 'server';
}

/** Configures the providers as the app does (`app.config.ts`), with `plausibleApiHost` in the runtime config, or no key at all. */
function configure(plausibleApiHost: unknown, options: BootOptions = {}): void {
  visit(options.href ?? 'https://app.example/');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(ROUTES),
      { provide: LT_RUNTIME_CONFIG, useValue: plausibleApiHost === undefined ? {} : { plausibleApiHost } },
      ...(options.platform ? [{ provide: PLATFORM_ID, useValue: options.platform }] : []),
      providePlausible(),
    ],
  });
}

/**
 * The initializer does not wait for the tracker: `plausible-start.ts` and the tracker load on demand, one import after
 * the other. Resolves once both modules are loaded and what waited for them has run.
 */
async function lazyStartSettled(): Promise<void> {
  await import('./plausible-start');
  await import('@plausible-analytics/tracker');
  await new Promise((resolve) => setTimeout(resolve));
}

/** Boots the app and lets the lazy start settle, for a case that expects no tracker. */
async function boot(plausibleApiHost: unknown, options: BootOptions = {}): Promise<void> {
  configure(plausibleApiHost, options);
  await TestBed.inject(ApplicationInitStatus).donePromise;
  await lazyStartSettled();
}

/**
 * Boots the app and waits until the tracker was started. Under the load of `pnpm run check` the two imports take far
 * longer than alone, so the wait is bounded by time, not by rounds (below the 5 s a test may take).
 */
async function start(plausibleApiHost: unknown, options: BootOptions = {}): Promise<void> {
  await boot(plausibleApiHost, options);
  await vi.waitFor(() => expect(tracker.init).toHaveBeenCalled(), { timeout: 4000 });
  await new Promise((resolve) => setTimeout(resolve));
}

/** The configuration `providePlausible()` handed the tracker. */
function startedConfig(): PlausibleConfig {
  const [config] = tracker.init.mock.calls[0] ?? [];
  if (!config) {
    throw new Error('no tracker was started');
  }
  return config;
}

/** The `transformRequest` `providePlausible()` handed the tracker. */
function transformRequest(): (payload: PlausibleRequestPayload) => null | PlausibleRequestPayload {
  const { transformRequest: transform } = startedConfig();
  if (!transform) {
    throw new Error('the tracker got no transformRequest');
  }
  return transform;
}

beforeEach(() => {
  tracker.init.mockReset();
  tracker.track.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation });
  for (const link of document.head.querySelectorAll(`link[rel="preconnect"][href^="${HOST}"]`)) {
    link.remove();
  }
});

describe('providePlausible: whether the tracker starts', () => {
  it.each([
    ['no address', ''],
    ['an address of blanks', '   '],
    ['a value that is no string', true],
    ['no key at all', undefined],
  ])('starts nothing with %s: no tracker, no pageview, no preconnect, never plausible.io', async (_label, apiHost) => {
    await boot(apiHost);

    expect(tracker.init).not.toHaveBeenCalled();
    expect(tracker.track).not.toHaveBeenCalled();
    expect(preconnects()).toEqual([]);
  });

  // The Nuxt plugin is `plausible.client.ts`; here the provider itself checks the platform.
  it('starts nothing while the page is rendered on the server', async () => {
    await boot(HOST, { platform: 'server' });

    expect(tracker.init).not.toHaveBeenCalled();
    expect(tracker.track).not.toHaveBeenCalled();
  });

  // A test's TestBed, or an app destroyed while the tracker chunk still loads: the late start must not run into the
  // router of an app that is gone (`ObjectUnsubscribedError` on `router.events`).
  it('starts nothing once the app is destroyed before the tracker has loaded', async () => {
    configure(HOST);
    // Runs the initializer, which only begins to load `plausible-start.ts`; then the app goes away.
    TestBed.inject(ApplicationInitStatus);
    TestBed.resetTestingModule();

    await lazyStartSettled();

    expect(tracker.init).not.toHaveBeenCalled();
    expect(tracker.track).not.toHaveBeenCalled();
    expect(preconnects()).toEqual([]);
  });

  it('starts the tracker for an address set on the stage, and talks only to that server', async () => {
    await start('https://stats.example/');

    expect(tracker.init).toHaveBeenCalledOnce();
    expect(startedConfig()).toMatchObject({ autoCapturePageviews: false, endpoint: 'https://stats.example/api/event' });
  });

  it('takes the address trimmed', async () => {
    await start('  https://stats.example  ');

    expect(startedConfig().endpoint).toBe('https://stats.example/api/event');
    expect(preconnects()).toEqual(['https://stats.example']);
  });

  it('preconnects to that server', async () => {
    await start(HOST);

    expect(preconnects()).toEqual(['https://stats.example']);
  });

  it('keeps the automatic link, download and form capture off, which reports addresses the masks do not see', async () => {
    await start(HOST);

    expect(startedConfig()).toMatchObject({ fileDownloads: false, formSubmissions: false, outboundLinks: false });
  });

  it('sends the first pageview through the tracker, without the secrets of the URL', async () => {
    await start(HOST, { href: 'https://app.example/auth/reset-password?token=live-token' });

    expect(tracker.track).toHaveBeenCalledExactlyOnceWith('pageview', { url: 'https://app.example/auth/reset-password' });
  });
});

describe("providePlausible: the tracker's transformRequest", () => {
  it('sends every event with a masked URL and a referrer cut to its origin', async () => {
    await start(HOST);

    const sent = transformRequest()({
      d: 'app.example',
      n: 'Signup',
      r: 'https://mail.example/inbox/abcdefabcdefabcdefabcdef?q=max%40test.com',
      u: 'https://app.example/share/aB3dE?email=max%40test.com&utm_source=mail',
    });

    expect(sent).toEqual({ d: 'app.example', n: 'Signup', r: 'https://mail.example', u: 'https://app.example/share/:id?utm_source=mail' });
  });

  it('masks the address the tracker adds to a click on a tagged link, and keeps the other props', async () => {
    await start(HOST);

    const sent = transformRequest()({
      d: 'app.example',
      n: 'Open Order',
      p: { plan: 'pro', url: 'https://app.example/app/orders/6630f1c2a9b8c7d6e5f40312?email=max%40test.com&token=s3cr3t' },
      r: null,
      u: 'https://app.example/app/orders',
    });

    expect(sent?.p).toEqual({ plan: 'pro', url: 'https://app.example/app/orders/:id' });
  });

  it.each([
    ['a mailto link', 'mailto:max@test.com'],
    ['a tel link', 'tel:+491701234567'],
  ])('drops the address of %s', async (_label, url) => {
    await start(HOST);

    expect(transformRequest()({ d: 'app.example', n: 'Contact', p: { url }, r: null, u: 'https://app.example/' })?.p).toEqual({});
  });

  it('adds no props to an event that has none', async () => {
    await start(HOST);

    expect(transformRequest()({ d: 'app.example', n: 'pageview', r: null, u: 'https://app.example/' })).not.toHaveProperty('p');
  });

  it("keeps a static page of the app whole, in the URL and in a tagged link's `url`", async () => {
    await start(HOST);

    const sent = transformRequest()({
      d: 'app.example',
      n: 'Accept',
      p: { url: 'https://app.example/invite/accept?token=s3cr3t' },
      r: null,
      u: 'https://app.example/invite/accept?token=s3cr3t',
    });

    expect(sent).toMatchObject({ p: { url: 'https://app.example/invite/accept' }, u: 'https://app.example/invite/accept' });
  });
});

describe('providePlausible against the real tracker: what leaves the page', () => {
  const ENDPOINT = `${HOST}/api/event`;
  const SECRET_HREF = 'https://app.example/app/orders/6630f1c2a9b8c7d6e5f40312?email=max%40test.com&token=s3cr3t';
  const TRACKER_FILE = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'node_modules', '@plausible-analytics', 'tracker', 'plausible.js')).href;
  /** The request bodies sent to this block's endpoint; requests of another tracker instance in the worker are not counted. */
  const sent: PlausibleRequestPayload[] = [];
  let previousPlausible: unknown;

  beforeAll(async () => {
    previousPlausible = (window as unknown as { plausible?: unknown }).plausible;
    // With `captureOnLocalhost: false` the tracker ignores automated browsers unless this is set.
    (window as unknown as { __plausible?: boolean }).__plausible = true;
    vi.stubGlobal('fetch', async (url: string, request: { body: string }) => {
      if (url === ENDPOINT) {
        sent.push(JSON.parse(request.body) as PlausibleRequestPayload);
      }
      return new Response(null, { status: 202 });
    });
    tracker.init.mockReset();
    await start(HOST, { href: 'https://app.example/app/orders' });
    const config = startedConfig();
    const real = (await import(/* @vite-ignore */ `${TRACKER_FILE}?instance=plausible-spec`)) as Tracker;
    real.init(config);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, '__plausible');
    (window as unknown as { plausible?: unknown }).plausible = previousPlausible;
  });

  beforeEach(() => {
    sent.length = 0;
  });

  function clickTagged(href: string): void {
    const link = document.createElement('a');
    link.className = 'plausible-event-name=Open+Order';
    link.href = href;
    // Keeps the DOM from following the link. The tracker still reports a prevented click.
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.append(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    link.remove();
  }

  it('sends the tagged link with its id masked and its query dropped', async () => {
    visit('https://app.example/app/orders');

    clickTagged(SECRET_HREF);

    await vi.waitFor(() => expect(sent.some((body) => body.n === 'Open Order')).toBe(true));
    expect(sent.find((body) => body.n === 'Open Order')?.p?.['url']).toBe('https://app.example/app/orders/:id');
    expect(JSON.stringify(sent)).not.toMatch(/6630f1c2|s3cr3t|max/);
  });

  it('sends a tagged mailto link without the address', async () => {
    visit('https://app.example/app/orders');

    clickTagged('mailto:max@test.com');

    await vi.waitFor(() => expect(sent.some((body) => body.n === 'Open Order')).toBe(true));
    expect(JSON.stringify(sent)).not.toContain('max');
  });

  // Angular has no `$plausible.trackEvent`: a custom event goes through `window.plausible`, which the tracker binds.
  it('sends a custom event of `window.plausible` with a masked URL and a referrer cut to its origin', async () => {
    visit('https://app.example/share/aB3dE?email=max%40test.com&utm_source=mail');
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://mail.example/inbox/abcdefabcdefabcdefabcdef?q=max%40test.com' });
    try {
      (window as unknown as { plausible: (eventName: string, options?: PlausibleEventOptions) => void }).plausible('Signup', { props: { plan: 'pro' } });

      await vi.waitFor(() => expect(sent.some((body) => body.n === 'Signup')).toBe(true));
    } finally {
      Reflect.deleteProperty(document, 'referrer');
    }
    expect(sent.find((body) => body.n === 'Signup')).toMatchObject({ p: { plan: 'pro' }, r: 'https://mail.example', u: 'https://app.example/share/:id?utm_source=mail' });
    expect(JSON.stringify(sent)).not.toMatch(/aB3dE|max|inbox/);
  });

  // The Nuxt module's default `ignoredHostnames: ['localhost']`; there is no list beyond it here.
  it('drops events from localhost', async () => {
    visit('http://localhost:3001/app/orders');
    clickTagged(SECRET_HREF);
    // The same click from a public host does go out, and after the one before it.
    visit('https://app.example/app/orders');
    clickTagged(SECRET_HREF);

    await vi.waitFor(() => expect(sent.some((body) => body.n === 'Open Order')).toBe(true));
    expect(sent.map((body) => body.u)).toEqual(['https://app.example/app/orders']);
  });
});
