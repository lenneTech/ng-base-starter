import type { Routes } from '@angular/router';

import { resolveRoute, routePaths } from './route-resolver';

const config: Routes = [
  {
    path: '',
    children: [
      { path: 'auth', children: [{ path: 'login', redirectTo: '' }] },
      {
        path: '',
        children: [
          { path: '', redirectTo: '' },
          { path: 'invite/accept', redirectTo: '' },
          { path: 'invite/:code', redirectTo: '' },
          { path: '**', redirectTo: '' },
        ],
      },
    ],
  },
];

describe('resolveRoute', () => {
  it('resolves a static path to its static chain', () => {
    expect(resolveRoute(config, '/auth/login').matched.at(-1)?.path).toBe('/auth/login');
    expect(resolveRoute(config, '/invite/accept?x=1').matched.at(-1)?.path).toBe('/invite/accept');
  });

  it('resolves a dynamic path to the parameter route, and an unknown one to the wildcard', () => {
    expect(resolveRoute(config, '/invite/aB3dE').matched.at(-1)?.path).toBe('/invite/:code');
    expect(resolveRoute(config, '/nowhere/at/all').matched.at(-1)?.path).toBe('/:**');
  });

  it('resolves the root', () => {
    expect(resolveRoute(config, '/').matched.at(-1)?.path).toBe('/');
  });
});

describe('routePaths', () => {
  it('lists every leaf with its full path', () => {
    expect(routePaths(config)).toEqual(['/auth/login', '/', '/invite/accept', '/invite/:code', '/**']);
  });
});
