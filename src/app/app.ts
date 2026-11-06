import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LtBugReport } from '@lenne.tech/ng-base/bug';
import { LT_BUG_ACTIVE } from '@lenne.tech/ng-base/bug/provide';

import { Toaster } from './shared/toaster';

/**
 * Root shell: the layouts (default, slim) are route components below it. The toast region loads when the page is idle.
 * bug.lt loads only where it is active (`LT_BUG_ACTIVE`: outside production, the same on server and browser), right
 * after the first render, so its recording starts early; in production nothing of it is loaded.
 */
@Component({
  imports: [LtBugReport, RouterOutlet, Toaster],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly bugActive = inject(LT_BUG_ACTIVE);
}
