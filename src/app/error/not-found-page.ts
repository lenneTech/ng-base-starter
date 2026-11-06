import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@lenne.tech/ng-base/ui';

/** Every unknown path: a German 404 with a way back (the Nuxt template's `error.vue`), answered with HTTP 404. */
@Component({
  imports: [HlmButton, RouterLink],
  selector: 'app-not-found-page',
  templateUrl: './not-found-page.html',
})
export class NotFoundPage {
  constructor() {
    const responseInit = inject(RESPONSE_INIT, { optional: true });
    if (responseInit) {
      responseInit.status = 404;
    }
  }
}
