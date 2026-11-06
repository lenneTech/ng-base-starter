/**
 * Renders the real `/app/settings/ai` page (ai-settings-page.ts/.html with the real ng-base UI) and drives its MCP
 * confirmation switch. Port of the Nuxt template's `tests/unit/pages/settings-ai-mcp-confirmation.test.ts`.
 *
 * WHAT IT PINS
 *
 * The switch is the user's "bypass permissions" mode for MCP (nest-server 12.3.0, DEV-2653): switched off, an MCP
 * client runs destructive tools in the user's name without asking. So the page has to show that state as a warning for
 * as long as it lasts, show the switch locked when the server enforces the value, never offer a switch it could not
 * save, and report a refused change in German rather than as the raw `#LTNS_0609` marker. The round trip against a
 * real API (stored, survives a reload) is `tests/e2e/ai-settings-mcp-confirmation.spec.ts`; the enforced state needs a
 * server started with `ai.mcp.confirmation.enforced`, so it is pinned here.
 *
 * HOW
 *
 * The AI services are fakes with the contract of ng-base 22 (`LtAiSettingsService.update()` adopts the server's
 * answer, or throws and keeps the old value; the AI route guard has loaded `LtAiStatusService` before the page
 * renders). Toast and error translation record what the page shows.
 *
 * The switch is the real `hlm-switch`, on purpose. It keeps its own checked state (a `linkedSignal` of `[checked]`)
 * and flips it on a click whatever the page does next; it adopts `[checked]` again only when that input changes. After
 * a refused change the input does not change, so a page that did not re-create the switch from the server value would
 * show a state the server does not hold, e.g. "on" while MCP keeps running destructive tools without asking. A
 * hand-written controlled stub would hide exactly that, as it did in the Nuxt template with USwitch.
 *
 * TestBed rethrows every application error, so a case that throws fails; that is what the Nuxt cases check with
 * `errors: []`.
 */
import { computed, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { LtErrorTranslationService, LtToastService, type LtToastOptions } from '@lenne.tech/ng-base';
import { LtAiConnectionsService, LtAiSettingsService, LtAiStatusService, LtAiUsageService } from '@lenne.tech/ng-base/ai';

import { AiSettingsPage } from './ai-settings-page';

interface Settings {
  mcpConfirmation: boolean;
  mcpConfirmationEnforced: boolean;
}

const ENFORCED_DE = 'Diese KI-Einstellung ist vom Server festgelegt und kann nicht geändert werden.';
const WARNING = 'Destruktive Aktionen werden über MCP ohne Rückfrage ausgeführt.';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function renderPage(options: { initial?: null | Settings; loadError?: string; mcp?: boolean; refuse?: string } = {}) {
  const toasts: LtToastOptions[] = [];
  const settings = signal<null | Settings>(null);
  const error = signal<null | string>(null);
  const loadSettings = vi.fn(async () => {
    if (options.loadError) {
      error.set(options.loadError);
      return;
    }
    settings.set(options.initial === undefined ? { mcpConfirmation: true, mcpConfirmationEnforced: false } : options.initial);
  });
  const update = vi.fn(async (input: { mcpConfirmation?: boolean }) => {
    if (options.refuse) {
      error.set(options.refuse);
      throw new Error(options.refuse);
    }
    const current = settings();
    if (current) {
      settings.set({ ...current, ...input });
    }
  });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: LtAiConnectionsService,
        useValue: { connections: signal([]), load: vi.fn(async () => {}), locked: signal(false), select: vi.fn(async () => {}), selected: computed(() => undefined) },
      },
      { provide: LtAiUsageService, useValue: { load: vi.fn(async () => {}), usage: signal(null) } },
      {
        provide: LtAiSettingsService,
        useValue: { enforced: computed(() => settings()?.mcpConfirmationEnforced === true), error, load: loadSettings, loading: signal(false), settings, update },
      },
      // As ng-base 22: the AI route guard has loaded the status before the page renders.
      { provide: LtAiStatusService, useValue: { enabled: signal(true), load: vi.fn(async () => {}), mcp: signal(options.mcp ?? true) } },
      {
        provide: LtToastService,
        useValue: {
          show: (toast: LtToastOptions) => {
            toasts.push(toast);
            return true;
          },
        },
      },
      {
        provide: LtErrorTranslationService,
        useValue: { translateError: (refused: unknown) => (refused instanceof Error && refused.message.startsWith('#LTNS_0609') ? ENFORCED_DE : String(refused)) },
      },
    ],
  });
  const fixture = TestBed.createComponent(AiSettingsPage);
  await settle(fixture);
  const root = fixture.nativeElement as HTMLElement;

  const findSwitch = () => root.querySelector<HTMLButtonElement>('[role="switch"]');
  const toggle = (): HTMLButtonElement => {
    const element = findSwitch();
    if (!element) {
      throw new Error('no switch');
    }
    return element;
  };
  /** The text of every notice of a variant (`lt-notice` renders `data-variant`). */
  const notices = (variant: string) => [...root.querySelectorAll(`[data-variant="${variant}"]`)].map((element) => element.textContent ?? '');

  return {
    async click(): Promise<void> {
      toggle().click();
      await settle(fixture);
    },
    findSwitch,
    loadSettings,
    notices,
    root,
    toasts,
    toggle,
    update,
  };
}

describe('AI settings page: MCP confirmation switch', () => {
  it('shows the switch on, with no warning, while MCP asks', async () => {
    const page = await renderPage();

    expect(page.toggle().getAttribute('aria-checked')).toBe('true');
    expect(page.toggle().disabled).toBe(false);
    expect(page.notices('warning')).toEqual([]);
  });

  it('switches the question off, confirms it, and warns for as long as it stays off', async () => {
    const page = await renderPage();

    await page.click();

    expect(page.update).toHaveBeenCalledWith({ mcpConfirmation: false });
    expect(page.toggle().getAttribute('aria-checked')).toBe('false');
    expect(page.notices('warning').join(' ')).toContain(WARNING);
    expect(page.toasts.at(-1)?.color).toBe('success');
  });

  it('warns at once when the stored setting is already off', async () => {
    const page = await renderPage({ initial: { mcpConfirmation: false, mcpConfirmationEnforced: false } });

    expect(page.toggle().getAttribute('aria-checked')).toBe('false');
    expect(page.notices('warning').join(' ')).toContain(WARNING);
  });

  it('switches the question back on and drops the warning', async () => {
    const page = await renderPage({ initial: { mcpConfirmation: false, mcpConfirmationEnforced: false } });

    await page.click();

    expect(page.update).toHaveBeenCalledWith({ mcpConfirmation: true });
    expect(page.notices('warning')).toEqual([]);
  });

  it('locks the switch and says why when the server enforces the value', async () => {
    const page = await renderPage({ initial: { mcpConfirmation: true, mcpConfirmationEnforced: true } });

    expect(page.toggle().disabled).toBe(true);
    expect(page.notices('info').join(' ')).toContain('vom Server festgelegt');
  });

  it('reports a refused change in German and keeps the previous value', async () => {
    const page = await renderPage({ refuse: '#LTNS_0609: This AI setting is fixed by the server' });

    await page.click();

    expect(page.toasts.at(-1)).toMatchObject({ color: 'error', description: ENFORCED_DE });
    // hlm-switch had flipped itself to "off" on the click; the page re-creates it from what the server holds.
    expect(page.toggle().getAttribute('aria-checked')).toBe('true');
    expect(page.notices('warning')).toEqual([]);
  });

  // The direction that matters: the server keeps running destructive tools without asking, so the switch must not
  // claim it asks again.
  it('keeps showing "off" and keeps warning when switching the question back on fails', async () => {
    const page = await renderPage({ initial: { mcpConfirmation: false, mcpConfirmationEnforced: false }, refuse: 'HTTP 401' });

    await page.click();

    expect(page.update).toHaveBeenCalledWith({ mcpConfirmation: true });
    expect(page.toasts.at(-1)?.color).toBe('error');
    expect(page.toggle().getAttribute('aria-checked')).toBe('false');
    expect(page.notices('warning').join(' ')).toContain(WARNING);
  });

  it('offers no switch it could not save when the settings cannot be loaded', async () => {
    const page = await renderPage({ loadError: 'HTTP 404' });

    expect(page.findSwitch()).toBeNull();
    expect(page.root.textContent).toContain('Die Einstellung ist gerade nicht verfügbar.');
    expect(page.notices('warning')).toEqual([]);
  });

  // `GET /ai/status` reports `mcp: false` while the API runs no MCP server (`ai.mcp` unset). The switch would then
  // change a setting nothing reads, so the card is not offered at all.
  it('shows no MCP card and asks for no settings while the API runs no MCP server', async () => {
    const page = await renderPage({ mcp: false });

    expect(page.findSwitch()).toBeNull();
    expect(page.root.textContent).not.toContain('MCP-Rückfrage');
    expect(page.loadSettings).not.toHaveBeenCalled();
  });
});
