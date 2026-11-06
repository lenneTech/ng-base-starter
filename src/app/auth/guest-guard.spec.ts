import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, convertToParamMap, provideRouter, Router, type RouterStateSnapshot, UrlTree } from '@angular/router';
import { LtAuthStore } from '@lenne.tech/ng-base/auth/provide';

import { guestGuard } from './guest-guard';

function run(signedIn: boolean, redirect: null | string): boolean | UrlTree {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LtAuthStore, useValue: { isAuthenticated: signal(signedIn) } }],
  });
  const route = { queryParamMap: convertToParamMap(redirect === null ? {} : { redirect }) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => guestGuard(route, {} as RouterStateSnapshot)) as boolean | UrlTree;
}

describe('guestGuard', () => {
  it('lets an anonymous visitor in', () => {
    expect(run(false, '/app/settings/security')).toBe(true);
  });

  it('sends a signed-in visitor on to the validated deep link', () => {
    const result = run(true, '/app/settings/security');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/app/settings/security');
  });

  it('falls back to /app for a missing target', () => {
    const result = run(true, null);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/app');
  });

  it('never follows a protocol-relative target', () => {
    const result = run(true, '//evil.example');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/app');
  });
});
