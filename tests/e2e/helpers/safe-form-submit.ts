/**
 * Race-safe submit helper for Chrome-DevTools-MCP / Playwright / any synthetic
 * event driver. See `src/app/auth/login-page.ts` for the underlying race description.
 *
 * Why this exists:
 *   An SSR-rendered form calls `event.preventDefault()` inside its bubble
 *   submit-handler. The handler is attached during per-component hydration. A
 *   synthetic click that fires BEFORE that listener is attached (which happens
 *   easily with MCP / fast automation) causes the native form GET to run —
 *   leaking credentials into the URL and bypassing the SPA sign-in flow.
 *
 *   The product code now also attaches a capture-phase preventDefault so the
 *   URL leak cannot happen even in the race window. This helper additionally
 *   ensures the AUTHENTICATION ACTUALLY HAPPENS in the same case: it waits a
 *   short moment for hydration, then dispatches the submit event via the
 *   browser API `form.requestSubmit()`, which is guaranteed to deliver the
 *   event to every bound listener.
 *
 * Usage from a Chrome MCP / Playwright test:
 *
 *   await page.evaluate(safeFormSubmit, { formSelector: 'form', delayMs: 200 });
 *
 * Or inline as an MCP `evaluate_script`:
 *
 *   () => {
 *     const f = document.querySelector('form');
 *     if (!f) return { ok: false, reason: 'no form' };
 *     return new Promise((resolve) => setTimeout(() => {
 *       f.requestSubmit();
 *       resolve({ ok: true });
 *     }, 200));
 *   }
 */
export async function safeFormSubmit(options: { delayMs?: number; formSelector?: string } = {}): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const selector = options.formSelector ?? 'form';
  const delayMs = options.delayMs ?? 200;
  const form = document.querySelector<HTMLFormElement>(selector);
  if (!form) {
    return { ok: false, reason: `no form matching "${selector}"` };
  }
  await new Promise((r) => setTimeout(r, delayMs));
  form.requestSubmit();
  return { ok: true };
}
