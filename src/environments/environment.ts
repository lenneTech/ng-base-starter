export const environment = {
  production: false,

  // Settings for @lenne.tech/ng-base
  prefix: 'app',
  apiUrl: 'http://127.0.0.1:3000/graphql',
  wsUrl: 'ws://127.0.0.1:3000/graphql',
  authGuardRedirectUrl: '/auth',
  logging: false,
  // version: '0.0.1',
  // scrollDetectionOffset: 200,
  // scrollOffset: 100,
  // scrollSamplingRate: 100,
  // storageType: 'local',
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
