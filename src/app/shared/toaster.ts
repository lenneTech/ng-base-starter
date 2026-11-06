import { Component } from '@angular/core';
import { HlmToaster } from '@lenne.tech/ng-base/ui';

/**
 * The toast region of the app (Sonner via `@lenne.tech/ng-base/ui`), with the Nuxt template's toaster settings:
 * bottom right, 5 s, not expanded. A component of its own so the root shell can load it with `@defer (on idle)`:
 * the UI layer then stays out of the initial bundle.
 */
@Component({
  imports: [HlmToaster],
  selector: 'app-toaster',
  templateUrl: './toaster.html',
})
export class Toaster {}
