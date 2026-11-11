/**
 * `/app/admin/system` when the API does not report its build (found in a project, DEV-4180; both starters get it).
 *
 * The page exists to spot a broken rollout. A failed `GET <api>/meta` used to end as commit `unknown`, which
 * `buildsMatch()` never warns about: an API outage looked exactly like a local build, with no error and no way to
 * ask again. Now it is an error alert with "Erneut versuchen":
 * - the button stays mounted while it works and is busy without `disabled`, so a keyboard user keeps the focus;
 * - a retry that fails as well says so with the time (in an outage the answer is instant, and an unchanged page would
 *   read as a button that does nothing);
 * - a retry that succeeds removes the alert, and the focus moves to the API heading instead of dropping to <body>.
 *
 * Renders the real page with the real ng-base UI; only HTTP is replaced (`HttpTestingController`).
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { LtApiUrlService } from '@lenne.tech/ng-base';

import { SystemPage } from './system-page';

const META_URL = 'https://api.example.test/meta';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * Runs effects and change detection a few rounds. Not `whenStable()`: it waits for the open `httpResource` requests,
 * which these tests answer only afterwards through `HttpTestingController`.
 */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    TestBed.tick();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function renderPage(): Promise<{ fixture: ComponentFixture<SystemPage>; http: HttpTestingController; root: HTMLElement }> {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: LtApiUrlService, useValue: { buildUrl: (path: string) => `https://api.example.test${path}` } }],
  });
  const fixture = TestBed.createComponent(SystemPage);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/build-identity').flush({ commit: COMMIT, version: '22.0.5' });
  return { fixture, http, root: fixture.nativeElement as HTMLElement };
}

function failMeta(http: HttpTestingController): void {
  http.expectOne(META_URL).flush({ message: 'down' }, { status: 503, statusText: 'Service Unavailable' });
}

function answerMeta(http: HttpTestingController): void {
  http.expectOne(META_URL).flush({ commit: COMMIT, environment: 'local', version: '12.8.5' });
}

function retryButton(root: HTMLElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('Erneut versuchen'));
}

describe('SystemPage: the API does not report its build', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    document.body.replaceChildren();
  });

  it('shows a failed GET /meta as an error with a retry, never as an unknown build', async () => {
    const { fixture, http, root } = await renderPage();
    failMeta(http);
    await settle(fixture);

    expect(root.querySelector('[data-testid="system-api-failed"]')?.textContent).toContain('API-Build nicht abrufbar');
    expect(retryButton(root)).toBeDefined();
    expect(root.textContent).not.toContain('App und API laufen auf unterschiedlichen Builds');
    expect(root.querySelector('[data-testid="system-api-commit"]')).toBeNull();
    expect(root.textContent).toContain('Keine Angaben, solange die API nicht antwortet.');
  });

  it('says when a retry failed as well, and keeps the button and its focus (busy, never disabled)', async () => {
    const { fixture, http, root } = await renderPage();
    failMeta(http);
    await settle(fixture);

    const button = retryButton(root);
    button?.focus();
    button?.click();
    await settle(fixture);

    expect(retryButton(root)).toBe(button);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.disabled).toBe(false);

    failMeta(http);
    await settle(fixture);

    expect(root.querySelector('[data-testid="system-api-failed"]')?.textContent).toMatch(/Letzter Versuch um \d{2}:\d{2}:\d{2} Uhr: weiterhin keine Antwort\./);
    expect(root.querySelector('[role="status"].sr-only')?.textContent).toMatch(/Erneuter Versuch um \d{2}:\d{2}:\d{2} Uhr fehlgeschlagen\./);
    expect(retryButton(root)).toBe(button);
    expect(button?.hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('removes the alert after a successful retry and moves the focus to the API heading', async () => {
    const { fixture, http, root } = await renderPage();
    failMeta(http);
    await settle(fixture);

    retryButton(root)?.focus();
    retryButton(root)?.click();
    await settle(fixture);
    answerMeta(http);
    await settle(fixture);

    expect(root.querySelector('[data-testid="system-api-failed"]')).toBeNull();
    expect(root.querySelector('[data-testid="system-api-commit"]')?.textContent?.trim()).toBe(COMMIT.slice(0, 7));
    expect(document.activeElement?.textContent?.trim()).toBe('API (Backend)');
    expect(document.activeElement?.tagName).toBe('H3');
  });

  it('shows no error when the API answers on the first load', async () => {
    const { fixture, http, root } = await renderPage();
    answerMeta(http);
    await settle(fixture);

    expect(root.querySelector('[data-testid="system-api-failed"]')).toBeNull();
    expect(root.querySelector('[data-testid="system-api-commit"]')).not.toBeNull();
    expect(root.textContent).not.toContain('App und API laufen auf unterschiedlichen Builds');
  });
});
