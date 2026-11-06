import { inject, Service } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { SITE_NAME } from './site';

/**
 * Browser titles "<page> | <site>", and the site name alone for a route without its own title (the landing page).
 * Never "<site> | <site>": the Nuxt template once rendered exactly that in every tab and bookmark.
 */
@Service()
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page && page !== SITE_NAME ? `${page} | ${SITE_NAME}` : SITE_NAME);
  }
}
