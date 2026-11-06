import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router, type RouterStateSnapshot, UrlTree } from '@angular/router';
import { LtAiStatusService } from '@lenne.tech/ng-base/ai';

import { aiRouteGuard } from './ai-route-guard';

async function run(url: string, enabled: boolean): Promise<{ load: ReturnType<typeof vi.fn>; result: unknown }> {
  const load = vi.fn(async () => undefined);
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LtAiStatusService, useValue: { enabled: signal(enabled), load } }] });
  const result = await TestBed.runInInjectionContext(() => aiRouteGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
  return { load, result };
}

describe('aiRouteGuard', () => {
  it('leaves non-AI routes alone without asking for the status', async () => {
    const { load, result } = await run('/app/settings/security', false);
    expect(result).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('opens an AI route while the module is on', async () => {
    expect((await run('/app/ai', true)).result).toBe(true);
  });

  it('sends an AI route to /app while the module is off', async () => {
    const { result } = await run('/app/admin/ai/connections?x=1', false);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/app');
  });
});
