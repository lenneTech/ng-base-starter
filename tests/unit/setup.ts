/**
 * Vitest setup for the tooling and contract tests (`tests/unit/`, Node environment).
 *
 * Keeps a handle on the real `fetch` BEFORE mocking it: contract tests that deliberately
 * reach the network (see `playwright-image-contract.test.ts`) need it. Without this they
 * would silently receive `undefined` from the mock, and a test that treats that as
 * "network unavailable" passes while checking nothing.
 */
import { vi } from 'vitest';

globalThis.__realFetch = globalThis.fetch;
globalThis.fetch = vi.fn();

vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});

export { vi };

declare global {
  // eslint-disable-next-line no-var
  var __realFetch: typeof fetch;
}
