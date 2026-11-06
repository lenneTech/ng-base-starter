import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { provideLtUiOverlayDefaults } from '@lenne.tech/ng-base/ui';

/**
 * Layout of `/auth/**`: a skip link and a centred `<main>` landmark around the page card.
 *
 * `<main>` rather than a bare `<div>`: without a landmark, assistive tech has no way to jump past the chrome to the
 * content. `px-4`: the cards are a fixed width; below it they shrink to the screen width and would run flush to the
 * edge on a phone without the gutter.
 *
 * `provideLtUiOverlayDefaults()`: dialogs and other overlays of the pages below stay out of the browser's top layer, so
 * toasts show above them (see DefaultLayout).
 */
@Component({
  imports: [RouterOutlet],
  providers: [provideLtUiOverlayDefaults()],
  selector: 'app-slim-layout',
  templateUrl: './slim-layout.html',
})
export class SlimLayout {
  /**
   * The skip link moves focus to `<main>` itself instead of following `#main-content`: with `<base href="/">` the
   * fragment resolves to `/#main-content`, which would leave the page (and drop a reset token or `?redirect=`).
   */
  protected skipToContent(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
