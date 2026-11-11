/**
 * The GitHub links in header, footer and start page point at `SITE_REPO_URL`, and disappear when it is `null` (the
 * Nuxt template's `tests/unit/site-repo-link.test.ts`, #44).
 *
 * `lt fullstack init` sets `SITE_REPO_URL` to `null` in every generated project (`tests/unit/site-contract.test.ts`):
 * a new project has no public repository, and a link to the starter's would send its users to a stranger's code. A
 * link that ignored the constant would stay visible. The first two cases read the value from `site.ts`, so they hold in
 * the starter (a link) and in a generated project (none); for the `null` case in the starter the components' copy of
 * the constant is set to `null` before the first render, as the CLI's rewrite of `site.ts` leaves it.
 * `tests/e2e/site-identity.spec.ts` checks the same in the browser, in the starter and in a generated project.
 */
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LtAiStatusService } from '@lenne.tech/ng-base/ai';
import { LtAuthService } from '@lenne.tech/ng-base/auth';

import { HomePage } from '../home/home-page';
import { SITE_NAME, SITE_REPO_URL } from '../shared/site';
import { DefaultLayout } from './default-layout';

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: LtAuthService,
        useValue: { isAdmin: signal(false), isAuthenticated: signal(false), signOut: async () => {}, user: signal(null), validateSession: async () => true },
      },
      { provide: LtAiStatusService, useValue: { enabled: signal(false), load: async () => {} } },
    ],
  });
}

async function render<T>(fixture: ComponentFixture<T>): Promise<HTMLElement> {
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

function githubLinks(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href*="github.com"]')].map((link) => link.getAttribute('href') ?? '');
}

describe('GitHub links follow SITE_REPO_URL', () => {
  it('header and footer link to SITE_REPO_URL while there is one, and the header names the site', async () => {
    configure();
    const root = await render(TestBed.createComponent(DefaultLayout));

    expect(githubLinks(root)).toEqual(SITE_REPO_URL ? [SITE_REPO_URL, SITE_REPO_URL] : []);
    expect(root.querySelector('header')?.textContent).toContain(SITE_NAME);
  });

  it('the start page links to SITE_REPO_URL while there is one', async () => {
    configure();
    const root = await render(TestBed.createComponent(HomePage));

    expect(githubLinks(root)).toEqual(SITE_REPO_URL ? [SITE_REPO_URL] : []);
  });

  it('a generated project (SITE_REPO_URL null): no GitHub link in header and footer', async () => {
    configure();
    const fixture = TestBed.createComponent(DefaultLayout);
    (fixture.componentInstance as unknown as { githubUrl: null | string }).githubUrl = null;
    const root = await render(fixture);

    expect(githubLinks(root)).toEqual([]);
  });

  it('a generated project (SITE_REPO_URL null): no GitHub link on the start page', async () => {
    configure();
    const fixture = TestBed.createComponent(HomePage);
    const page = fixture.componentInstance as unknown as { links: Record<string, null | string> };
    page.links = { ...page.links, github: null };
    const root = await render(fixture);

    expect(githubLinks(root)).toEqual([]);
  });
});
